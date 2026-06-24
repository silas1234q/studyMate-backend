import { Request, Response } from "express";
import crypto from "crypto";
import { getAuth } from "@clerk/express";
import { catchAsync } from "../utils/catchAsync";
import AuthError from "../errors/AuthError";
import ValidationError from "../errors/ValidationError";
import prisma from "../config/db.config";
import { getSubscriptionStatus } from "../services/subscription.service";
import {
  fetchPlan,
  initializeTransaction,
  verifyTransaction,
  cancelSubscription as paystackCancel,
  listCustomerSubscriptions,
} from "../services/paystack.service";

const PLAN_CODES: Record<string, string | undefined> = {
  "monthly_GHS": process.env.PAYSTACK_PRO_MONTHLY_GHS_PLAN_CODE,
  "yearly_GHS": process.env.PAYSTACK_PRO_YEARLY_GHS_PLAN_CODE,
  "monthly_INT": process.env.PAYSTACK_PRO_MONTHLY_INT_PLAN_CODE,
  "yearly_INT": process.env.PAYSTACK_PRO_YEARLY_INT_PLAN_CODE,
};

export const handleGetSubscription = catchAsync(
  async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) throw new AuthError("user not authenticated");
    const status = await getSubscriptionStatus(userId);
    res.json(status);
  }
);

export const handleInitiateUpgrade = catchAsync(
  async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) throw new AuthError("user not authenticated");

    const { interval, region, callbackUrl } = req.body as {
      interval?: string;
      region?: string;
      callbackUrl?: string;
    };

    if (!interval || !["monthly", "yearly"].includes(interval)) {
      throw new ValidationError("interval must be 'monthly' or 'yearly'");
    }
    if (!region || !["GHS", "INT"].includes(region)) {
      throw new ValidationError("region must be 'GHS' or 'INT'");
    }
    if (!callbackUrl) {
      throw new ValidationError("callbackUrl is required");
    }

    const planCode = PLAN_CODES[`${interval}_${region}`];
    if (!planCode) {
      throw new ValidationError("Plan not configured for this interval/region combination");
    }

    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
      select: { id: true, email: true },
    });
    if (!user) throw new AuthError("user not found");

    const plan = await fetchPlan(planCode);

    const result = await initializeTransaction(
      user.email,
      planCode,
      plan.amount,
      callbackUrl,
      { userId: user.id, clerkId: userId, interval, region },
    );

    res.json({ authorizationUrl: result.authorization_url, reference: result.reference });
  }
);

export const handleVerifyPayment = catchAsync(
  async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) throw new AuthError("user not authenticated");

    const reference = req.query.reference as string;
    if (!reference) throw new ValidationError("reference query param is required");

    const txData = await verifyTransaction(reference);

    if (txData.status !== "success") {
      res.json({ success: false, message: "Payment was not successful" });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
      select: { id: true },
    });
    if (!user) throw new AuthError("user not found");

    // Find the subscription Paystack created for this customer
    const customerCode = txData.customer.customer_code;
    let subscriptionCode: string | null = null;
    let emailToken: string | null = null;
    let nextPaymentDate: string | null = null;

    try {
      const subs = await listCustomerSubscriptions(customerCode);
      const activeSub = subs.find((s) => s.status === "active");
      if (activeSub) {
        subscriptionCode = activeSub.subscription_code;
        emailToken = activeSub.email_token;
        nextPaymentDate = activeSub.next_payment_date;
      }
    } catch {
      // Non-critical — we can update via webhook later
    }

    const interval = txData.metadata?.interval ?? txData.plan_object?.interval ?? null;
    const currency = txData.metadata?.region ?? txData.metadata?.currency ?? null;

    await prisma.subscription.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        plan: "pro",
        status: "active",
        interval,
        currency,
        paystackCustomerCode: customerCode,
        paystackSubscriptionCode: subscriptionCode,
        paystackEmailToken: emailToken,
        currentPeriodStart: new Date(),
        currentPeriodEnd: nextPaymentDate ? new Date(nextPaymentDate) : null,
      },
      update: {
        plan: "pro",
        status: "active",
        interval,
        currency,
        paystackCustomerCode: customerCode,
        paystackSubscriptionCode: subscriptionCode,
        paystackEmailToken: emailToken,
        currentPeriodStart: new Date(),
        currentPeriodEnd: nextPaymentDate ? new Date(nextPaymentDate) : null,
        cancelledAt: null,
      },
    });

    res.json({ success: true, plan: "pro" });
  }
);

export const handleCancelSubscription = catchAsync(
  async (req: Request, res: Response) => {
    const { userId } = getAuth(req);
    if (!userId) throw new AuthError("user not authenticated");

    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
      select: { id: true },
    });
    if (!user) throw new AuthError("user not found");

    const sub = await prisma.subscription.findUnique({ where: { userId: user.id } });
    if (!sub || sub.plan !== "pro") {
      throw new ValidationError("No active Pro subscription to cancel");
    }
    if (!sub.paystackSubscriptionCode || !sub.paystackEmailToken) {
      throw new ValidationError("This subscription cannot be cancelled (lifetime Pro)");
    }

    await paystackCancel(sub.paystackSubscriptionCode, sub.paystackEmailToken);

    await prisma.subscription.update({
      where: { userId: user.id },
      data: {
        cancelledAt: new Date(),
        status: "cancelled",
      },
    });

    res.json({
      success: true,
      message: "Subscription cancelled. You'll retain Pro access until the end of your billing period.",
      activeUntil: sub.currentPeriodEnd,
    });
  }
);

export const handleWebhook = async (req: Request, res: Response) => {
  const secret = process.env.PAYSTACK_SECRET_KEY!;
  const signature = req.headers["x-paystack-signature"] as string;

  const rawBody = typeof req.body === "string"
    ? req.body
    : req.body instanceof Buffer
      ? req.body.toString("utf8")
      : JSON.stringify(req.body);

  const hash = crypto.createHmac("sha512", secret).update(rawBody).digest("hex");

  if (hash !== signature) {
    res.status(401).json({ message: "Invalid signature" });
    return;
  }

  const event = typeof req.body === "string" || req.body instanceof Buffer
    ? JSON.parse(rawBody)
    : req.body;

  const { event: eventType, data } = event;

  try {
    switch (eventType) {
      case "subscription.create": {
        const customerCode = data.customer?.customer_code;
        if (!customerCode) break;
        const sub = await prisma.subscription.findFirst({
          where: { paystackCustomerCode: customerCode },
        });
        if (sub) {
          await prisma.subscription.update({
            where: { id: sub.id },
            data: {
              plan: "pro",
              status: "active",
              paystackSubscriptionCode: data.subscription_code,
              paystackEmailToken: data.email_token,
              currentPeriodStart: new Date(),
              currentPeriodEnd: data.next_payment_date ? new Date(data.next_payment_date) : null,
            },
          });
        }
        break;
      }

      case "charge.success": {
        const customerCode = data.customer?.customer_code;
        if (!customerCode) break;
        const sub = await prisma.subscription.findFirst({
          where: { paystackCustomerCode: customerCode },
        });
        if (sub) {
          // Renewal — update period dates
          const nextDate = data.plan_object?.next_payment_date;
          await prisma.subscription.update({
            where: { id: sub.id },
            data: {
              status: "active",
              currentPeriodStart: new Date(),
              ...(nextDate ? { currentPeriodEnd: new Date(nextDate) } : {}),
            },
          });
        }
        break;
      }

      case "invoice.payment_failed": {
        const customerCode = data.customer?.customer_code;
        if (!customerCode) break;
        const sub = await prisma.subscription.findFirst({
          where: { paystackCustomerCode: customerCode },
        });
        if (sub) {
          await prisma.subscription.update({
            where: { id: sub.id },
            data: { status: "past_due" },
          });
        }
        break;
      }

      case "subscription.not_renew": {
        const subCode = data.subscription_code;
        if (!subCode) break;
        const sub = await prisma.subscription.findFirst({
          where: { paystackSubscriptionCode: subCode },
        });
        if (sub) {
          await prisma.subscription.update({
            where: { id: sub.id },
            data: { cancelledAt: new Date() },
          });
        }
        break;
      }

      case "subscription.disable": {
        const subCode = data.subscription_code;
        if (!subCode) break;
        const sub = await prisma.subscription.findFirst({
          where: { paystackSubscriptionCode: subCode },
        });
        if (sub) {
          // If period has ended, downgrade. Otherwise mark cancelled.
          const periodEnd = sub.currentPeriodEnd;
          const now = new Date();
          if (!periodEnd || now >= periodEnd) {
            await prisma.subscription.update({
              where: { id: sub.id },
              data: { plan: "free", status: "expired", cancelledAt: new Date() },
            });
          } else {
            await prisma.subscription.update({
              where: { id: sub.id },
              data: { status: "cancelled", cancelledAt: new Date() },
            });
          }
        }
        break;
      }
    }
  } catch (err) {
    console.error("[webhook] Error processing event:", eventType, err);
  }

  // Always return 200 to acknowledge
  res.status(200).json({ received: true });
};

import { Request, Response } from "express";
import crypto from "crypto";
import { getAuth } from "@clerk/express";
import { catchAsync } from "../utils/catchAsync";
import AuthError from "../errors/AuthError";
import ValidationError from "../errors/ValidationError";
import prisma from "../config/db.config";
import { getSubscriptionStatus } from "../services/subscription.service";
import {
  initializeTransaction,
  verifyTransaction,
  cancelSubscription as paystackCancel,
  listCustomerSubscriptions,
} from "../services/paystack.service";
import { Prisma } from "../../generated/prisma/client";

// Amounts in pesewas (Paystack API uses subunits). All plans are in GHS.
// GHS plans: GHS 15/mo, GHS 100/yr
// INT plans: GHS 30/mo, GHS 240/yr (equivalent of ~$3/mo, ~$15/yr)
const PLANS: Record<string, { code: string | undefined; amount: number }> = {
  "monthly_GHS": { code: process.env.PAYSTACK_PRO_MONTHLY_GHS_PLAN_CODE, amount: 1500 },
  "yearly_GHS":  { code: process.env.PAYSTACK_PRO_YEARLY_GHS_PLAN_CODE,  amount: 10000 },
  "monthly_INT": { code: process.env.PAYSTACK_PRO_MONTHLY_INT_PLAN_CODE, amount: 3000 },
  "yearly_INT":  { code: process.env.PAYSTACK_PRO_YEARLY_INT_PLAN_CODE,  amount: 24000 },
};
type RevenueCatEvent = {
  id: string;
  type: string;
  app_user_id: string;
  product_id?: string;
  new_product_id?: string | null;        // PRODUCT_CHANGE
  entitlement_ids?: string[] | null;
  expiration_at_ms?: number | null;
  purchased_at_ms?: number | null;
  event_timestamp_ms?: number;
  original_transaction_id?: string | null;
  store?: string;
  environment?: string;
  cancel_reason?: string | null;
};

type RevenueCatPayload = {
  event: RevenueCatEvent;
};

const PLAN = "pro"; // same value Paystack uses

const safeEqual = (a: string, b: string) => {
  const A = Buffer.from(a), B = Buffer.from(b);
  return A.length === B.length && crypto.timingSafeEqual(A, B);
};

const intervalOf = (productId?: string | null) =>
  productId?.includes("yearly") ? "yearly" : productId?.includes("monthly") ? "monthly" : null;



// function getPlan(productId?: string): string {
//   switch (productId) {
//     case 'studymate_premium_monthly':
//       return 'premium';
//     case 'studymate_premium_yearly':
//       return 'premium';
//     default:
//       return 'premium';
//   }
// }

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

    const lookupKey = `${interval}_${region}`;
    const plan = PLANS[lookupKey];
    if (!plan) {
      throw new ValidationError("Plan not configured for this interval/region combination");
    }

    // GHS users use one-time payments (no plan code → enables MoMo)
    // INT users use card-based subscriptions (plan code required)
    const planCode = region === "GHS" ? null : plan.code ?? null;
    if (region === "INT" && !planCode) {
      throw new ValidationError("Plan not configured for this interval/region combination");
    }

    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
      select: { id: true, email: true },
    });
    if (!user) throw new AuthError("user not found");

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

    const customerCode = txData.customer.customer_code;
    const interval = txData.metadata?.interval ?? txData.plan_object?.interval ?? null;
    const currency = txData.metadata?.region ?? txData.metadata?.currency ?? null;

    if (currency === "GHS") {
      // GHS one-time payment: calculate period end manually, no Paystack subscription
      const now = new Date();
      let periodEnd: Date;
      if (interval === "yearly") {
        periodEnd = new Date(now);
        periodEnd.setFullYear(periodEnd.getFullYear() + 1);
      } else {
        periodEnd = new Date(now);
        periodEnd.setDate(periodEnd.getDate() + 30);
      }

      // If user already has an active sub with future end date, extend from that date
      const existingSub = await prisma.subscription.findUnique({ where: { userId: user.id } });
      if (
        existingSub &&
        existingSub.status === "active" &&
        existingSub.currentPeriodEnd &&
        existingSub.currentPeriodEnd > now
      ) {
        const base = existingSub.currentPeriodEnd;
        if (interval === "yearly") {
          periodEnd = new Date(base);
          periodEnd.setFullYear(periodEnd.getFullYear() + 1);
        } else {
          periodEnd = new Date(base);
          periodEnd.setDate(periodEnd.getDate() + 30);
        }
      }

      await prisma.subscription.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          plan: "pro",
          status: "active",
          interval,
          currency,
          paystackCustomerCode: customerCode,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
        },
        update: {
          plan: "pro",
          status: "active",
          interval,
          currency,
          paystackCustomerCode: customerCode,
          paystackSubscriptionCode: null,
          paystackEmailToken: null,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          cancelledAt: null,
        },
      });
    } else {
      // INT card-based subscription: find Paystack subscription as before
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
    }

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

    // GHS one-time payment users: cancel locally without calling Paystack API
    const isGhsOneTime = !sub.paystackSubscriptionCode && sub.currency === "GHS";

    if (isGhsOneTime) {
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
      return;
    }

    // INT users: cancel via Paystack API
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

  if (
    !signature ||
    !crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(signature, "hex"))
  ) {
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

export const handleRevenuecatWebhook = async (req: Request, res: Response) => {
  const expected = process.env.REVENUECAT_WEBHOOK_AUTHORIZATION;
  if (!expected || !safeEqual(req.headers.authorization ?? "", expected)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const event = (req.body as { event?: RevenueCatEvent })?.event;
  if (!event?.id || !event.type || !event.app_user_id) {
    res.status(400).json({ error: "Invalid RevenueCat event" });
    return;
  }
  if (event.type === "TEST") {
    res.status(200).json({ received: true });
    return;
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Idempotency: count === 0 means we've seen this event
      const inserted = await tx.revenueCatWebhookEvent.createMany({
        data: [{ id: event.id, eventType: event.type }],
        skipDuplicates: true,
      });
      if (inserted.count === 0) return;

      // app_user_id may be your DB id or the Clerk id depending on logIn()
      const user = await tx.user.findFirst({
        where: { OR: [{ id: event.app_user_id }, { clerkId: event.app_user_id }] },
        select: { id: true },
      });
      if (!user) {
        // anonymous ids / unknown users: ack so RevenueCat doesn't retry
        console.warn("[revenuecat] no user for", event.app_user_id, event.type);
        return;
      }

      const now = new Date();
      const eventAt = new Date(event.event_timestamp_ms ?? now.getTime());
      const existing = await tx.subscription.findUnique({ where: { userId: user.id } });

      // Ignore stale / out-of-order events
      if (existing?.lastEventAt && existing.lastEventAt > eventAt) return;

      const expiration = event.expiration_at_ms != null ? new Date(event.expiration_at_ms) : null;
      const purchased = event.purchased_at_ms != null ? new Date(event.purchased_at_ms) : now;
      const isExpired = !!expiration && expiration <= now;
      const productId = event.new_product_id ?? event.product_id;

      const base = {
        billingProvider: "revenuecat",
        revenueCatAppUserId: event.app_user_id,
        revenueCatProductId: productId ?? null,
        store: event.store ?? null,
        originalTransactionId: event.original_transaction_id ?? null,
        isSandbox: event.environment === "SANDBOX",
        lastVerifiedAt: now,
        lastEventAt: eventAt,
      };

      let data: Record<string, unknown> | null = null;

      switch (event.type) {
        case "INITIAL_PURCHASE":
        case "RENEWAL":
        case "UNCANCELLATION":
        case "SUBSCRIPTION_EXTENDED":
        case "PRODUCT_CHANGE":
        case "REFUND_REVERSED":
          data = {
            ...base,
            plan: isExpired ? "free" : PLAN,
            status: isExpired ? "expired" : "active",
            interval: intervalOf(productId) ?? existing?.interval ?? null,
            revenueCatEntitlementId: "premium",
            currentPeriodStart: purchased,
            currentPeriodEnd: expiration,
            cancelledAt: null,
            willRenew: true,
          };
          break;

        case "CANCELLATION":
          if (event.cancel_reason === "CUSTOMER_SUPPORT") {
            // refund → revoke immediately
            data = { ...base, plan: "free", status: "expired", revenueCatEntitlementId: null,
                     currentPeriodEnd: now, cancelledAt: now, willRenew: false };
          } else {
            // auto-renew off; access continues until expiration
            data = { ...base, status: isExpired ? "expired" : "cancelled",
                     currentPeriodEnd: expiration ?? existing?.currentPeriodEnd,
                     cancelledAt: now, willRenew: false };
          }
          break;

        case "EXPIRATION":
          data = { ...base, plan: "free", status: "expired", revenueCatEntitlementId: null,
                   currentPeriodEnd: expiration ?? now, willRenew: false };
          break;

        case "BILLING_ISSUE":
          data = { ...base, status: "past_due" };
          break;
      }

      if (!data) return;

      await tx.subscription.upsert({
        where: { userId: user.id },
        create: { userId: user.id, ...(data as any) },
        update: data as any,
      });
    });

    res.status(200).json({ received: true });
  } catch (error) {
    console.error("RevenueCat webhook failed:", error);
    res.status(500).json({ error: "Webhook processing failed" });
  }
};

export const handleSyncRevenuecat = catchAsync(async (req: Request, res: Response) => {
  const { userId } = getAuth(req);
  if (!userId) throw new AuthError("user not authenticated");

  const user = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true },
  });
  if (!user) throw new AuthError("user not found");

  // Must be the same ID the app passes to Purchases.logIn()
  const rcRes = await fetch(
    `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(user.id)}`,
    { headers: { Authorization: `Bearer ${process.env.REVENUECAT_SECRET_API_KEY}` } },
  );
  if (!rcRes.ok) throw new Error(`RevenueCat lookup failed: ${rcRes.status}`);

  const { subscriber } = await rcRes.json();
  const ent = subscriber?.entitlements?.premium;

  const expiresAt = ent?.expires_date ? new Date(ent.expires_date) : null; // null = lifetime
  const isActive = !!ent && (!expiresAt || expiresAt > new Date());

  if (!isActive) {
    res.json({ success: true, plan: "free", active: false });
    return;
  }

  const productId: string = ent.product_identifier;
  const sub = subscriber.subscriptions?.[productId];

  const data = {
    billingProvider: "revenuecat",
    plan: "pro",
    status: sub?.unsubscribe_detected_at ? "cancelled" : "active",
    interval: productId.includes("yearly") ? "yearly" : productId.includes("monthly") ? "monthly" : null,
    revenueCatAppUserId: user.id,
    revenueCatProductId: productId,
    revenueCatEntitlementId: "premium",
    store: sub?.store ?? null,
    isSandbox: !!sub?.is_sandbox,
    willRenew: !sub?.unsubscribe_detected_at,
    currentPeriodStart: ent.purchase_date ? new Date(ent.purchase_date) : new Date(),
    currentPeriodEnd: expiresAt,
    lastVerifiedAt: new Date(),
    // don't touch lastEventAt: that field belongs to the webhook's ordering check
  };

  await prisma.subscription.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...data },
    update: data,
  });

  res.json({ success: true, plan: "pro", active: true });
});
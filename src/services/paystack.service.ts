const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY!;
const BASE_URL = "https://api.paystack.co";

function headers() {
  return {
    Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
    "Content-Type": "application/json",
  };
}

async function paystackFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { ...headers(), ...options.headers },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Paystack error: ${data.message || res.statusText}`);
  }
  return data;
}

export async function initializeTransaction(
  email: string,
  planCode: string | null,
  amountInPesewas: number,
  callbackUrl: string,
  metadata: Record<string, string>,
) {
  const body: Record<string, unknown> = {
    email,
    amount: amountInPesewas,
    callback_url: callbackUrl,
    metadata,
  };
  if (planCode) {
    body.plan = planCode;
  }
  const data = await paystackFetch("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return data.data as { authorization_url: string; access_code: string; reference: string };
}

export async function verifyTransaction(reference: string) {
  const data = await paystackFetch(`/transaction/verify/${encodeURIComponent(reference)}`);
  return data.data as {
    status: string;
    customer: { customer_code: string; email: string };
    plan_object?: { plan_code: string; interval: string };
    metadata?: Record<string, string>;
  };
}

export async function getSubscription(subscriptionCode: string) {
  const data = await paystackFetch(`/subscription/${encodeURIComponent(subscriptionCode)}`);
  return data.data;
}

export async function cancelSubscription(subscriptionCode: string, emailToken: string) {
  await paystackFetch("/subscription/disable", {
    method: "POST",
    body: JSON.stringify({ code: subscriptionCode, token: emailToken }),
  });
}

export async function listCustomerSubscriptions(customerCode: string) {
  const data = await paystackFetch(`/subscription?customer=${encodeURIComponent(customerCode)}`);
  return data.data as Array<{
    subscription_code: string;
    plan: { plan_code: string; interval: string };
    status: string;
    email_token: string;
    next_payment_date: string;
    created_at: string;
  }>;
}

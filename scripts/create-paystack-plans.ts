import "dotenv/config";

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
if (!PAYSTACK_SECRET_KEY) {
  console.error("PAYSTACK_SECRET_KEY is not set in .env");
  process.exit(1);
}

const plans = [
  {
    name: "StudyMate Pro Monthly (GHS)",
    amount: 1500,       // GHS 15 in pesewas
    interval: "monthly",
    currency: "GHS",
    envKey: "PAYSTACK_PRO_MONTHLY_GHS_PLAN_CODE",
  },
  {
    name: "StudyMate Pro Yearly (GHS)",
    amount: 5000,       // GHS 50 in pesewas
    interval: "annually",
    currency: "GHS",
    envKey: "PAYSTACK_PRO_YEARLY_GHS_PLAN_CODE",
  },
  {
    name: "StudyMate Pro Monthly (USD)",
    amount: 300,        // $3 in cents
    interval: "monthly",
    currency: "USD",
    envKey: "PAYSTACK_PRO_MONTHLY_USD_PLAN_CODE",
  },
  {
    name: "StudyMate Pro Yearly (USD)",
    amount: 1000,       // $10 in cents
    interval: "annually",
    currency: "USD",
    envKey: "PAYSTACK_PRO_YEARLY_USD_PLAN_CODE",
  },
];

async function createPlan(plan: typeof plans[0]) {
  const res = await fetch("https://api.paystack.co/plan", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: plan.name,
      amount: plan.amount,
      interval: plan.interval,
      currency: plan.currency,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error(`Failed to create "${plan.name}":`, data.message);
    return null;
  }

  console.log(`Created "${plan.name}" → ${data.data.plan_code}`);
  return { envKey: plan.envKey, planCode: data.data.plan_code as string };
}

async function main() {
  console.log("Creating Paystack plans...\n");

  const results = [];
  for (const plan of plans) {
    const result = await createPlan(plan);
    if (result) results.push(result);
  }

  console.log("\n--- Add these to your backend/.env ---\n");
  for (const { envKey, planCode } of results) {
    console.log(`${envKey}=${planCode}`);
  }
  console.log("");
}

main().catch(console.error);

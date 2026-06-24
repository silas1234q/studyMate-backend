import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is not set");
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  const users = await prisma.user.findMany({ select: { id: true } });
  console.log(`Found ${users.length} existing users to grandfather...`);

  let created = 0;
  for (const user of users) {
    const existing = await prisma.subscription.findUnique({
      where: { userId: user.id },
    });
    if (!existing) {
      await prisma.subscription.create({
        data: {
          userId: user.id,
          plan: "pro",
          status: "active",
        },
      });
      created++;
    }
  }

  console.log(`Created ${created} Pro subscriptions (${users.length - created} already had one).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

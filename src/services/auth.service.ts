import { clerkClient } from "@clerk/express";
import prisma from "../config/db.config";
import AuthError from "../errors/AuthError";

export const authService = async (clerkId: string) => {
  let clerkUser;
  try {
    clerkUser = await clerkClient.users.getUser(clerkId);
  } catch {
    throw new AuthError("user not authenticated");
  }

  const primaryEmail = clerkUser.primaryEmailAddress?.emailAddress;
  if (!primaryEmail) throw new AuthError("user email not found");

  const avatarUrl = clerkUser.imageUrl ?? null;
  const userData = {
    clerkId,
    email: primaryEmail,
    firstName: clerkUser.firstName ?? "",
    lastName: clerkUser.lastName ?? "",
    avatarUrl,
  };

  const existing = await prisma.user.findFirst({
    where: { OR: [{ clerkId }, { email: primaryEmail }] },
  });

  const user = existing
    ? await prisma.user.update({ where: { id: existing.id }, data: userData })
    : await prisma.user.create({ data: userData });

  return user;
};

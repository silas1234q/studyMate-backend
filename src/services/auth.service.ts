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

  // Auto-detect onboarded users: if they have preferences in DB but Clerk
  // metadata is missing (e.g. after switching Clerk to production), set it.
  const hasPreferences = await prisma.userPreferences.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });

  if (hasPreferences && !clerkUser.publicMetadata?.onboarded) {
    await clerkClient.users.updateUserMetadata(clerkId, {
      publicMetadata: { onboarded: true },
    });
  }

  return user;
};

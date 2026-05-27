import { clerkClient } from "@clerk/express";
import  prisma from "../config/db.config";
import AuthError from "../errors/AuthError";
import NotFoundError from "../errors/NotFoundError";

export const authService = async (clerkId: string) => {
  const clerkUser = await clerkClient.users.getUser(clerkId);
  if (!clerkUser) throw new AuthError("user not authenticated");
  const primaryEmail = clerkUser.primaryEmailAddress?.emailAddress;
  if(!primaryEmail) throw new AuthError('user email not found');
  const phone = clerkUser.phoneNumbers[0]?.phoneNumber
  const avatarUrl = clerkUser?.imageUrl;

  const user = await prisma.user.upsert({
    where: { clerkId },
    update: {
      email: primaryEmail,
      firstName: clerkUser.firstName ?? "",
      lastName: clerkUser.lastName ?? "",
      avatarUrl: avatarUrl ?? "",
    },
    create: {
      clerkId: clerkUser.id,
      email: primaryEmail,
      firstName: clerkUser.firstName ?? "",
      lastName: clerkUser.lastName ?? "",
      avatarUrl: avatarUrl ?? "",
    },
  });
  if(!user) throw new NotFoundError('user')

    return user
};

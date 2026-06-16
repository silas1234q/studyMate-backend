import prisma from "../config/db.config";
import NotFoundError from "../errors/NotFoundError";

export async function getDbUser(clerkId: string) {
  const user = await prisma.user.findUnique({
    where: { clerkId },
    select: { id: true },
  });
  if (!user) throw new NotFoundError("user");
  return user;
}

export async function createConversation(clerkId: string) {
  const user = await getDbUser(clerkId);
  return prisma.quickConversation.create({
    data: { userId: user.id, title: "New Chat" },
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  });
}

export async function listConversations(clerkId: string) {
  const user = await getDbUser(clerkId);
  return prisma.quickConversation.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, updatedAt: true },
  });
}

export async function getConversationMessages(clerkId: string, conversationId: string) {
  const user = await getDbUser(clerkId);
  // Verify ownership
  const convo = await prisma.quickConversation.findFirst({
    where: { id: conversationId, userId: user.id },
    select: { id: true },
  });
  if (!convo) throw new NotFoundError("conversation");

  return prisma.quickChatMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, content: true, createdAt: true },
  });
}

export async function deleteConversation(clerkId: string, conversationId: string) {
  const user = await getDbUser(clerkId);
  const convo = await prisma.quickConversation.findFirst({
    where: { id: conversationId, userId: user.id },
    select: { id: true },
  });
  if (!convo) throw new NotFoundError("conversation");

  await prisma.quickConversation.delete({ where: { id: conversationId } });
}

export async function updateConversationTitle(conversationId: string, title: string) {
  await prisma.quickConversation.update({
    where: { id: conversationId },
    data: { title },
  });
}

export async function addMessage(conversationId: string, role: string, content: string) {
  await prisma.quickChatMessage.create({
    data: { conversationId, role, content },
  });
  // Touch updatedAt
  await prisma.quickConversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });
}

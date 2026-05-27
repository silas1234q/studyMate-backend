import { requireAuth } from "@clerk/express";

export const requireClerkAuth = requireAuth();
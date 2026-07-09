import { getAuth } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";

export const requireClerkAuth = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ success: false, type: "UNAUTHORIZED", message: "Authentication required" });
    return;
  }
  next();
};
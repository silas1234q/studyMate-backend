// middleware/errorHandler.ts
import { Request, Response, NextFunction } from "express";
import AppError from "../errors/AppError";

declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

const isProd = process.env.NODE_ENV === "production";

const isPrismaCode = (code: unknown): code is string =>
  typeof code === "string" && /^P\d{4}$/.test(code);

const handlePrismaError = (err: any): unknown => {
  switch (err.code) {
    case "P2002": {
      // Shape depends on the Prisma version / driver adapter: log err.meta once to confirm
      const target = err.meta?.target ?? err.meta?.driverAdapterError?.cause?.constraint?.fields;
      const field = Array.isArray(target) ? target[0] : typeof target === "string" ? target : undefined;
      return new AppError({
        message: "Duplicate field value",
        statusCode: 409,
        type: "DUPLICATE_RESOURCE",
        details: field ? [{ field, message: "Already exists" }] : null,
      });
    }
    case "P2025":
      return new AppError({ message: "Resource not found", statusCode: 404, type: "NOT_FOUND" });
    case "P2003":
      return new AppError({
        message: "Related resource does not exist",
        statusCode: 409,
        type: "INVALID_REFERENCE",
      });
    case "P2000":
      return new AppError({
        message: "A value is too long",
        statusCode: 400,
        type: "VALIDATION_ERROR",
      });
    default:
      return err; // falls through to a masked 500
  }
};

/** body-parser / http-errors: keep their 4xx status instead of turning it into a 500. */
const handleHttpError = (err: any): unknown => {
  if (err?.type === "entity.too.large") {
    return new AppError({
      message: "That content is too large to process. Try a smaller file.",
      statusCode: 413,
      type: "PAYLOAD_TOO_LARGE",
    });
  }
  if (err?.type === "entity.parse.failed") {
    return new AppError({
      message: "Malformed request body",
      statusCode: 400,
      type: "VALIDATION_ERROR",
    });
  }
  const status = err?.status ?? err?.statusCode;
  if (Number.isInteger(status) && status >= 400 && status < 500 && err?.expose) {
    return new AppError({ message: err.message, statusCode: status, type: "BAD_REQUEST" });
  }
  return err;
};

const normalizeError = (err: unknown): AppError => {
  if (err instanceof AppError) return err;

  const original = err instanceof Error ? err : new Error(String(err));
  const wrapped = new AppError({
    message: original.message,
    statusCode: 500,
    type: "INTERNAL_ERROR",
    isOperational: false,
  });
  wrapped.stack = original.stack; // keep the real origin, not this function
  return wrapped;
};

const logError = (err: AppError, req: Request) => {
  const level = err.isOperational ? "warn" : "error";
  const entry = {
    level,
    message: err.message,
    type: err.type,
    statusCode: err.statusCode,
    path: req.originalUrl,
    method: req.method,
    details: err.details,
    requestId: req.id,
    stack: err.isOperational ? undefined : err.stack,
  };
  (level === "warn" ? console.warn : console.error)(JSON.stringify(entry));
};

const sendResponse = (err: AppError, res: Response, req: Request) => {
  // Never expose internals of unexpected errors in production
  const message = !err.isOperational && isProd ? "Internal server error" : err.message;

  res.status(err.statusCode).json({
    success: false,
    type: err.type,
    message,
    details: err.details ?? null,
    requestId: req.id,
  });
};

export const globalErrorHandler = (err: unknown, req: Request, res: Response, next: NextFunction) => {
  let error: unknown = err;

  if (error && typeof error === "object") {
    if (isPrismaCode((error as any).code)) error = handlePrismaError(error);
    if (!(error instanceof AppError)) error = handleHttpError(error);
  }

  const normalized = normalizeError(error);
  logError(normalized, req);

  // Response already started (e.g. mid-stream): can't send JSON. Let Express
  // close the connection so the client sees the stream fail.
  if (res.headersSent) return next(err);

  sendResponse(normalized, res, req);
};
// middleware/errorHandler.js
import { Request, Response, NextFunction } from "express";
import AppError from "../errors/AppError";

declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

const handlePrismaError = (err: any) => {
  if (err.code === "P2002") {
    const field = err.meta?.target?.[0];

    return new AppError({
      message: "Duplicate field value",
      statusCode: 409,
      type: "DUPLICATE_RESOURCE",
      details: field ? [{ field, message: "Already exists" }] : null,
    });
  }

  if (err.code === "P2025") {
    return new AppError({
      message: "Resource not found",
      statusCode: 404,
      type: "NOT_FOUND",
    });
  }

  return err;
};

/**
 * body-parser rejects oversized or malformed bodies before any route runs, and its
 * errors sit outside the AppError hierarchy — untranslated they surface as a 500
 * with a stack trace, which tells the user nothing actionable.
 */
const handleBodyParserError = (err: any) => {
  if (err.type === "entity.too.large") {
    return new AppError({
      message: "That content is too large to process. Try a smaller file.",
      statusCode: 413,
      type: "PAYLOAD_TOO_LARGE",
    });
  }

  if (err.type === "entity.parse.failed") {
    return new AppError({
      message: "Malformed request body",
      statusCode: 400,
      type: "VALIDATION_ERROR",
    });
  }

  return err;
};

const normalizeError = (err: any) => {
  if (err instanceof AppError) return err;

  return new AppError({
    message: err?.message ?? String(err),
    statusCode: 500,
    type: "INTERNAL_ERROR",
    isOperational: false,
  });
};

const sendResponse = (err: AppError, res: Response, req: Request) => {
  res.status(err.statusCode).json({
    success: false,
    type: err.type,
    message: err.message,
    details: err.details,
    requestId: req.id,
  });
};

const logError = (err: AppError, req: Request) => {
  const log = {
    level: err.isOperational ? "warn" : "error",
    message: err.message,
    type: err.type,
    statusCode: err.statusCode,
    path: req.originalUrl,
    method: req.method,
    details: err.details,
    requestId: req.id,
    stack: err.isOperational ? undefined : err.stack,
  };

  console.error(JSON.stringify(log));
};

export const globalErrorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  let error = err;

  // Prisma errors
  if (error.code?.startsWith("P")) {
    error = handlePrismaError(error);
  }

  // body-parser errors (oversized/malformed body)
  if (!(error instanceof AppError)) {
    error = handleBodyParserError(error);
  }

  // Normalize unknown errors
  error = normalizeError(error);

  
  // Log
  logError(error, req);

  // Respond
  sendResponse(error, res, req);
};

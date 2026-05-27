import AppError from "./AppError";

class ConflictError extends AppError {
  constructor(message = "Conflict error") {
    super({
      message,
      statusCode: 409,
      type: "CONFLICT_ERROR",
      isOperational: true,
    });
  }
}

export default ConflictError;

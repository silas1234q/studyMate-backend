import AppError from "./AppError";

class ForbiddenError extends AppError {
  constructor(message = "Access denied") {
    super({
      message,
      statusCode: 403,
      type: "FORBIDDEN",
    });
  }
}

export default ForbiddenError;

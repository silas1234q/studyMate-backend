import AppError from "./AppError";

class NotFoundError extends AppError {
  constructor(resource = "Resource") {
    super({
      message: `${resource} not found`,
      statusCode: 404,
      type: "NOT_FOUND",
    });
  }
}

export default NotFoundError;

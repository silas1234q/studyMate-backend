import AppError from "./AppError";

class AuthError extends AppError {
  constructor(message = "Authentication required") {
    super({
      message,
      statusCode: 401,
      type: "AUTH_ERROR",
    });
  }
}

export default AuthError;

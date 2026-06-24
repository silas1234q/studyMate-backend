import AppError from "./AppError";

class SubscriptionError extends AppError {
  constructor(message = "Upgrade to Pro to access this feature") {
    super({
      message,
      statusCode: 403,
      type: "SUBSCRIPTION_LIMIT",
    });
  }
}

export default SubscriptionError;

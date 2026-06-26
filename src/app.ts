import express from "express";
import cors from "cors";
import morgan from "morgan";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { clerkMiddleware } from "@clerk/express";
import routes from "./routes";
import { globalErrorHandler } from "./middleware/globalErrorHandler";
import { handleWebhook } from "./controllers/subscription.controller";

const app = express();

// Security headers
app.use(helmet());

// CORS — whitelist allowed origins
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(",") ?? "http://localhost:5173",
  credentials: true,
}));

// Logging — only in development
if (process.env.NODE_ENV !== "production") {
  app.use(morgan("dev"));
}

// Global rate limit: 300 requests per 15 minutes per IP
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests, please try again later." },
}));

// Webhook needs raw body for HMAC verification — mount before express.json()
app.post("/api/subscription/webhook", express.raw({ type: "application/json" }), handleWebhook);

app.use(express.json({ limit: "1mb" }));
app.use(clerkMiddleware());

app.get("/", (_req, res) => res.json({ status: "OK" }));
app.use("/api", routes);

app.use(globalErrorHandler);

export default app;

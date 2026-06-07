import express from "express";
import cors from "cors";
import morgan from "morgan";
import { clerkMiddleware } from "@clerk/express";
import routes from "./routes";
import { globalErrorHandler } from "./middleware/globalErrorHandler";

const app = express();

app.use(cors());
app.use(morgan("dev"));
app.use(express.json());
app.use(clerkMiddleware());

app.get("/", (_req, res) => res.json({ status: "OK" }));
app.use("/api", routes);

app.use(globalErrorHandler);

export default app;
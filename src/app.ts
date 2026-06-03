import express from "express";
import cors from "cors";
import morgan from "morgan";
import { clerkMiddleware } from "@clerk/express";
import routes from "./routes";

const app = express();

app.use(cors());
app.use(morgan("dev"));
app.use(express.json());
app.use(clerkMiddleware());

app.use("/api", routes);

export default app;
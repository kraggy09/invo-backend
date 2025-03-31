import express, { Express, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

const app: Express = express();

// Security middleware
app.use(helmet());
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  })
);

// Logging middleware
app.use(morgan("dev"));

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Basic route
app.get("/", (req: Request, res: Response) => {
  res.json({ message: "Welcome to InvoSync API" });
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: Function) => {
  console.error(err.stack);
  res.status(500).json({ message: "Something went wrong!" });
});

export default app;

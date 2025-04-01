import express, { Express, Request, Response } from "express";
import cors from "cors";
import morgan from "morgan";
import chalk from "chalk";

const app: Express = express();

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  })
);

const colorizeLog = (status: string, log: string) => {
  if (status.startsWith("404")) return chalk.red.bold(log);
  if (status.startsWith("2")) return chalk.green.bold(log);
  if (status.startsWith("4")) return chalk.yellow.bold(log);
  if (status.startsWith("5")) return chalk.red.bold(log);
  return chalk.white(log);
};

morgan.token("body", (req: Request) => JSON.stringify(req.body || {}));

morgan.format("colored", (tokens, req: Request, res: Response) => {
  const status = tokens.status(req, res) || "000"; // Handle undefined cases
  const log = [
    tokens.method(req, res),
    tokens.url(req, res),
    status,
    tokens["response-time"](req, res) + "ms",
    "- Body:",
    tokens.body(req, res),
  ].join(" ");

  return colorizeLog(status, log);
});

app.use(morgan("colored"));

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

import express, { Express, Request, Response } from "express";
import cors from "cors";
import morgan from "morgan";
import rootRouter from "./routes/index";

const app: Express = express();

app.set("trust proxy", 1);
app.use(
  cors({
    origin: [
      "https://billing.kaifsk.com",
      "http://localhost:5173"
    ],
    credentials: true,
  })
);

// Use morgan's "dev" format for colored logs
app.use(morgan("dev"));

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api/v1", rootRouter);

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

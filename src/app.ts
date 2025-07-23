import express, { Express, Request, Response } from "express";
import cors from "cors";
import morgan from "morgan";
import userRouter from "./routes/user.route";
import productRouter from "./routes/product.route";
import billRouter from "./routes/bill.route";
import customerRouter from "./routes/customer.route";
import transactionRouter from "./routes/transaction.route";
import stockRouter from "./routes/stock.route";
import categoryRouter from "./routes/category.route";
import { verifyToken } from "./services/token.service";

const app: Express = express();

app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  })
);

// Use morgan's "dev" format for colored logs
app.use(morgan("dev"));

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api/v1", userRouter);
app.use(verifyToken);
app.use("/api/v1/products", productRouter);
app.use("/api/v1/bills", billRouter);
app.use("/api/v1/customers", customerRouter);
app.use("/api/v1/transactions", transactionRouter);
app.use("/api/v1", stockRouter);
app.use("/api/v1/categories", categoryRouter);

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

import express from "express";
import userRouter from "./user.route";
import productRouter from "./product.route";
import stockRouter from "./stock.route";
import billRouter from "./bill.route";
import customerRouter from "./customer.route";
import transactionRouter from "./transaction.route";
import categoryRouter from "./category.route";
import adminRouter from "./admin.route";
import journeyRouter from "./journey.route";
import returnBillRouter from "./returnBill.route";
import notificationRouter from "./notification.route";
import { verifyToken } from "../services/token.service";
import { Request, Response } from "express";

const rootRouter = express.Router();

// Mount unauthenticated routes

// Basic route
rootRouter.get("/", (req: Request, res: Response) => {
    res.json({ message: "Welcome to InvoSync API" });
});

rootRouter.use("/users", userRouter);

// Apply token verification for all subsequent routes
rootRouter.use(verifyToken);

// Mount authenticated routes under their respective domains
rootRouter.use("/products", productRouter);
rootRouter.use("/stocks", stockRouter);
rootRouter.use("/bills", billRouter);
rootRouter.use("/return-bills", returnBillRouter);
rootRouter.use("/customers", customerRouter);
rootRouter.use("/transactions", transactionRouter);
rootRouter.use("/categories", categoryRouter);
rootRouter.use("/admin", adminRouter);
rootRouter.use("/journey-logs", journeyRouter);
rootRouter.use("/notifications", notificationRouter);

export default rootRouter;

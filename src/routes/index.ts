import express from "express";
import userRouter from "./user.route";
import productRouter from "./product.route";
import stockRouter from "./stock.route";
import billRouter from "./bill.route";
import customerRouter from "./customer.route";
import transactionRouter from "./transaction.route";
import categoryRouter from "./category.route";
import adminRouter from "./admin.route";
import { verifyToken } from "../services/token.service";

const rootRouter = express.Router();

// Mount unauthenticated routes
rootRouter.use("/users", userRouter);

// Apply token verification for all subsequent routes
rootRouter.use(verifyToken);

// Mount authenticated routes under their respective domains
rootRouter.use("/products", productRouter);
rootRouter.use("/stocks", stockRouter);
rootRouter.use("/bills", billRouter);
rootRouter.use("/customers", customerRouter);
rootRouter.use("/transactions", transactionRouter);
rootRouter.use("/categories", categoryRouter);
rootRouter.use("/admin", adminRouter);

export default rootRouter;

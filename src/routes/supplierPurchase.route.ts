import express from "express";
import {
  raiseSupplierPurchase,
  acceptSupplierPurchase,
  approveSupplierPurchase,
  rejectSupplierPurchase,
  getAllSupplierPurchases,
  getProductPurchaseHistory,
  getSingleSupplierPurchase,
  getSupplierPurchaseSummary,
} from "../controllers/supplierPurchase.controller";
import { isAllowed } from "../services/token.service";

const supplierPurchaseRouter = express.Router();
const adminRoles = ["SUPER_ADMIN", "ADMIN", "CREATOR"];

supplierPurchaseRouter
  .route("/")
  .get(getAllSupplierPurchases)
  .post(raiseSupplierPurchase);

supplierPurchaseRouter
  .route("/summary")
  .get(getSupplierPurchaseSummary);

supplierPurchaseRouter
  .route("/product-history")
  .get(getProductPurchaseHistory);

supplierPurchaseRouter
  .route("/:id/accept")
  .patch(isAllowed(adminRoles), acceptSupplierPurchase);

supplierPurchaseRouter
  .route("/:id/approve")
  .post(isAllowed(adminRoles), approveSupplierPurchase);

supplierPurchaseRouter
  .route("/:id/reject")
  .post(isAllowed(adminRoles), rejectSupplierPurchase);

supplierPurchaseRouter
  .route("/:id")
  .get(getSingleSupplierPurchase);

export default supplierPurchaseRouter;


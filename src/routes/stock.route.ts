import express from "express";
import {
  acceptAllInventoryRequest,
  getInventoryUpdateRequest,
  rejectInventoryRequest,
  updateInventoryRequest,
  getAllRequests,
  reconcileStock,
  getReconciliationHistory,
} from "../controllers/stock.controller";
import { isAllowed } from "../services/token.service";

const stockRouter = express.Router();
const adminRoles = ["SUPER_ADMIN", "ADMIN", "CREATOR"];

stockRouter
  .route("/requests")
  .get(getInventoryUpdateRequest)
  .post(updateInventoryRequest);

stockRouter
  .route("/requests/accept-all")
  .post(isAllowed(adminRoles), acceptAllInventoryRequest);

stockRouter.route("/requests/all").get(getAllRequests);

stockRouter
  .route("/requests/:id/reject")
  .get(isAllowed(adminRoles), rejectInventoryRequest);

// Stock Reconciliation (Admin Only)
stockRouter
  .route("/reconcile")
  .post(isAllowed(adminRoles), reconcileStock);

stockRouter
  .route("/reconcile/history")
  .get(isAllowed(adminRoles), getReconciliationHistory);

export default stockRouter;

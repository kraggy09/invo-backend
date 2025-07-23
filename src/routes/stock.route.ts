import express from "express";
import {
  acceptAllInventoryRequest,
  getInventoryUpdateRequest,
  rejectInventoryRequest,
  updateInventoryRequest,
  getAllRequests,
} from "../controllers/stock.controller";

const stockRouter = express.Router();

stockRouter
  .route("/products/raise-stock-requests")
  .post(updateInventoryRequest);

// Depreceated all the stock updates are handled in the all endpoints
// stockRouter
//   .route("/products/accept-stock-requests")
//   .post(acceptInventoryRequest);

stockRouter.route("/products/get-all-requests").get(getAllRequests);

stockRouter.route("/products/get-requests").get(getInventoryUpdateRequest);
stockRouter
  .route("/products/reject-stock-request")
  .post(rejectInventoryRequest);

stockRouter
  .route("/products/accept-stock-requests")
  .post(acceptAllInventoryRequest);

export default stockRouter;

import express from "express";
import {
  acceptAllInventoryRequest,
  acceptInventoryRequest,
  getInventoryUpdateRequest,
  rejectInventoryRequest,
  updateInventoryRequest,
} from "../controllers/stock.controller";

const stockRouter = express.Router();

stockRouter
  .route("/products/updateInventoryRequest")
  .post(updateInventoryRequest);
stockRouter
  .route("/products/acceptInventoryRequest")
  .post(acceptInventoryRequest);
stockRouter.route("/products/requests").get(getInventoryUpdateRequest);
stockRouter
  .route("/products/deleteInventoryRequest")
  .delete(rejectInventoryRequest);
stockRouter
  .route("/products/updateAllInventroryRequests")
  .post(acceptAllInventoryRequest);

export default stockRouter;

import express from "express";
import {
  createNewProduct,
  deleteProduct,
  getAllproduct,
  getProduct,
  updateProductDetails,
} from "../controllers/product.controller";
import { isAllowed } from "../services/token.service";
const productRouter = express.Router();
const allowedRoles = ["SUPER_ADMIN", "ADMIN", "CREATOR"];


productRouter.route("/").post(createNewProduct).get(getAllproduct);

productRouter.use("/:id", isAllowed(allowedRoles));

productRouter
  .route("/:id")
  .get(getProduct)
  .delete(deleteProduct)
  .put(updateProductDetails);
export default productRouter;

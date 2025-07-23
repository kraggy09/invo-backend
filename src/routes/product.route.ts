import express from "express";
import {
  createNewProduct,
  deleteProduct,
  getAllproduct,
  getProduct,
  returnProduct,
  updateProductDetails,
} from "../controllers/product.controller";
const productRouter = express.Router();

productRouter.route("/products/new-item").post(createNewProduct);
productRouter.route("/product").get(getProduct);
productRouter.route("/all-products").get(getAllproduct);
productRouter.route("/products/delete").delete(deleteProduct);
productRouter.route("/products/update-product").post(updateProductDetails);
productRouter.route("/products/return").post(returnProduct);

export default productRouter;

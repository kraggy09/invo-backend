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

productRouter.route("/").post(createNewProduct).get(getAllproduct);
productRouter.route("/return").post(returnProduct);
productRouter.route("/:id").get(getProduct).delete(deleteProduct).put(updateProductDetails);

export default productRouter;

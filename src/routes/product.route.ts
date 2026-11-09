import express from "express";
import {
  createNewProduct,
  deleteProduct,
  getAllproduct,
  getProduct,
  updateProductDetails,
  getProductPriceHistory,
} from "../controllers/product.controller";
import { getNextBarcode } from "../controllers/shop.controller";
import { isAllowed } from "../services/token.service";
const productRouter = express.Router();
const allowedRoles = ["SUPER_ADMIN", "ADMIN", "CREATOR"];

productRouter.route("/next-barcode").get(getNextBarcode);
productRouter.route("/").post(createNewProduct).get(getAllproduct);

productRouter.route("/:id/price-history").get(getProductPriceHistory);

productRouter.use("/:id", isAllowed(allowedRoles));

productRouter
  .route("/:id")
  .get(getProduct)
  .delete(deleteProduct)
  .put(updateProductDetails);
export default productRouter;

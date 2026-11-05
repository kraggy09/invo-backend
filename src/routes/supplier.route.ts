import express from "express";
import {
  createSupplier,
  getAllSuppliers,
  getSingleSupplier,
  updateSupplier,
} from "../controllers/supplier.controller";

const supplierRouter = express.Router();

supplierRouter.route("/").get(getAllSuppliers).post(createSupplier);
supplierRouter.route("/:id").get(getSingleSupplier).patch(updateSupplier);

export default supplierRouter;


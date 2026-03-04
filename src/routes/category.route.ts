import express from "express";
import {
  createNewCategory,
  getAllCategories,
} from "../controllers/category.controller";

const categoryRouter = express.Router();

categoryRouter.route("/").post(createNewCategory).get(getAllCategories);

export default categoryRouter;

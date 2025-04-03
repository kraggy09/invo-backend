import express from "express";
import {
  createNewCategory,
  getAllCategories,
} from "../controllers/category.controller";

const categoryRouter = express.Router();

categoryRouter.route("/newCategory").post(createNewCategory);
categoryRouter.route("/getAllCategories").get(getAllCategories);

export default categoryRouter;

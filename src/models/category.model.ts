import mongoose, { Schema } from "mongoose";
import { ICategory } from "../types/category.type";

let categorySchema = new Schema<ICategory>({
  name: {
    type: String,
    required: true,
  },
  wholesale: {
    type: Number,
    required: true,
  },
  superWholeSale: {
    type: Number,
    required: true,
  },
});

const Category = mongoose.model("Category", categorySchema);

export default Category;

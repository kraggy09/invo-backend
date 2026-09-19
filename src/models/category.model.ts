import mongoose, { Schema } from "mongoose";
import { ICategory } from "../types/category.type";

let categorySchema = new Schema<ICategory>({
  shopId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Shop",
    required: true,
    index: true,
  },
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

// Compound unique: category name must be unique within a shop
categorySchema.index({ shopId: 1, name: 1 }, { unique: true });

const Category = mongoose.model("Category", categorySchema);

export default Category;

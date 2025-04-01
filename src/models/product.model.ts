import mongoose, { Schema } from "mongoose";
import { IProduct } from "../types/product.type";

const productSchema = new Schema<IProduct>({
  name: {
    type: String,
    required: true,
  },
  mrp: {
    type: Number,
    required: true,
  },
  costPrice: {
    type: Number,
    required: true,
  },
  measuring: {
    type: String,
    enum: ["kg", "piece"],
    required: true,
  },
  category: {
    type: String,
    required: true,
  },
  retailPrice: {
    type: Number,
    required: true,
  },
  wholesalePrice: {
    type: Number,
    required: true,
  },
  superWholesalePrice: {
    type: Number,
    required: true,
  },
  barcode: [
    {
      type: Number,
      required: true,
    },
  ],
  stock: {
    type: Number,
    required: true,
  },
  packet: {
    type: Number,
    required: true,
  },
  box: {
    type: Number,
    required: true,
  },
  minQuantity: {
    type: Number,
    required: true,
  },
  hi: {
    type: String,
  },
});

productSchema.virtual("totalPackets").get(function () {
  return Math.floor(this.stock / this.packet);
});

productSchema.virtual("totalStock").get(function () {
  const box = Math.floor(this.stock / this.box);
  const remainingItem = this.stock % this.box;
  return box + remainingItem; // You were missing the return statement
});

const Product = mongoose.model("Product", productSchema);

export default Product;

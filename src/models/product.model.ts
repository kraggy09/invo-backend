import mongoose, { Schema } from "mongoose";
import { IProduct } from "../types/product.type";

const productSchema = new Schema<IProduct>({
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
    default: null,
    required: false,
  },
  retailPrice: {
    type: Number,
    required: true,
  },
  wholesalePrice: {
    type: Number,
    default: 0,
    required: false,
  },
  superWholesalePrice: {
    type: Number,
    default: 0,
    required: false,
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
    default: 0,
    required: false,
  },
  box: {
    type: Number,
    default: 0,
    required: false,
  },
  minQuantity: {
    type: Number,
    required: true,
  },
  hi: {
    type: String,
  },
  idempotencyKey: {
    type: String,
    sparse: true,
    // No longer globally unique — compound index below
  },
}, { timestamps: true });

productSchema.virtual("totalPackets").get(function () {
  if (!this.packet || this.packet <= 0) return 0;
  return Math.floor(this.stock / this.packet);
});

productSchema.virtual("totalStock").get(function () {
  if (!this.box || this.box <= 0) return this.stock;
  const box = Math.floor(this.stock / this.box);
  const remainingItem = this.stock % this.box;
  return box + remainingItem;
});

// Compound indexes for multi-tenancy
productSchema.index({ shopId: 1, name: 1 });
productSchema.index({ shopId: 1, category: 1 });
productSchema.index(
  { shopId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: "string" } },
  }
);
productSchema.index({ shopId: 1, barcode: 1 });

const Product = mongoose.model("Product", productSchema);

export default Product;

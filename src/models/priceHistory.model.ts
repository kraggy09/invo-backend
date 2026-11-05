import mongoose, { Schema } from "mongoose";
import { IPriceHistory } from "../types/priceHistory.type";

const priceHistorySchema = new Schema<IPriceHistory>(
  {
    shopId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shop",
      required: true,
      index: true,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },
    changedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    source: {
      type: String,
      enum: ["MANUAL_EDIT", "SUPPLIER_PURCHASE"],
      required: true,
    },
    supplierPurchase: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SupplierPurchase",
    },
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
    },
    previousCostPrice: {
      type: Number,
      required: true,
    },
    newCostPrice: {
      type: Number,
      required: true,
    },
    previousRetailPrice: {
      type: Number,
      required: true,
    },
    newRetailPrice: {
      type: Number,
      required: true,
    },
    previousWholesalePrice: {
      type: Number,
      default: 0,
    },
    newWholesalePrice: {
      type: Number,
      default: 0,
    },
    previousSuperWholesalePrice: {
      type: Number,
      default: 0,
    },
    newSuperWholesalePrice: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

// Indexes
priceHistorySchema.index({ shopId: 1, product: 1, changedAt: -1 });

const PriceHistory = mongoose.model<IPriceHistory>(
  "PriceHistory",
  priceHistorySchema
);

export default PriceHistory;


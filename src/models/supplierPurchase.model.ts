import mongoose, { Schema } from "mongoose";
import { ISupplierPurchase } from "../types/supplierPurchase.type";

const supplierPurchaseItemSchema = new Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    previousCostPrice: {
      type: Number,
    },
    newCostPrice: {
      type: Number,
    },
    previousRetailPrice: {
      type: Number,
    },
    newRetailPrice: {
      type: Number,
    },
    previousWholesalePrice: {
      type: Number,
    },
    newWholesalePrice: {
      type: Number,
    },
    previousSuperWholesalePrice: {
      type: Number,
    },
    newSuperWholesalePrice: {
      type: Number,
    },
    priceUpdated: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false }
);

const supplierPurchaseSchema = new Schema<ISupplierPurchase>(
  {
    shopId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shop",
      required: true,
      index: true,
    },
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "ACCEPTED", "APPROVED", "REJECTED"],
      default: "PENDING",
      required: true,
      index: true,
    },
    raisedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    raisedAt: {
      type: Date,
      default: Date.now,
    },
    acceptedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    acceptedAt: {
      type: Date,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    approvedAt: {
      type: Date,
    },
    rejectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    rejectedAt: {
      type: Date,
    },
    items: {
      type: [supplierPurchaseItemSchema],
      required: true,
      validate: [
        (val: any[]) => Array.isArray(val) && val.length > 0,
        "Purchase must have at least one item",
      ],
    },
    totalAmount: {
      type: Number,
      default: 0,
    },
    paymentMode: {
      type: String,
      enum: ["CASH", "CREDIT", "PARTIAL"],
    },
    cashPaid: {
      type: Number,
      default: 0,
    },
    creditAmount: {
      type: Number,
      default: 0,
    },
    previousSupplierOutstanding: {
      type: Number,
    },
    newSupplierOutstanding: {
      type: Number,
    },
  },
  { timestamps: true }
);

// Compound indexes for multi-tenancy and fast filtering
supplierPurchaseSchema.index({ shopId: 1, supplier: 1, createdAt: -1 });
supplierPurchaseSchema.index({ shopId: 1, status: 1, createdAt: -1 });
supplierPurchaseSchema.index({ shopId: 1, "items.product": 1 });

const SupplierPurchase = mongoose.model<ISupplierPurchase>(
  "SupplierPurchase",
  supplierPurchaseSchema
);

export default SupplierPurchase;


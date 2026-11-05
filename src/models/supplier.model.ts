import mongoose, { Schema } from "mongoose";
import { ISupplier } from "../types/supplier.type";

const supplierSchema = new Schema<ISupplier>(
  {
    shopId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shop",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    address: {
      type: String,
      default: "",
    },
    outstanding: {
      type: Number,
      default: 0,
    },
    idempotencyKey: {
      type: String,
      sparse: true,
    },
  },
  { timestamps: true }
);

// Compound indexes for multi-tenancy
supplierSchema.index({ shopId: 1, phone: 1 }, { unique: true });
supplierSchema.index({ shopId: 1, name: 1 });
supplierSchema.index(
  { shopId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: "string" } },
  }
);

const Supplier = mongoose.model<ISupplier>("Supplier", supplierSchema);

export default Supplier;


import mongoose from "mongoose";
import { Schema } from "mongoose";
import { ILogger } from "../types/logger.type";

let loggerSchema = new Schema<ILogger>(
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
    },

    previousQuantity: {
      type: Number,
      required: true,
    },

    quantity: {
      type: Number,
      required: true,
    },

    newQuantity: {
      type: Number,
      required: true,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
    },
  },
  { timestamps: true }
);

// Compound indexes for multi-tenancy
loggerSchema.index({ shopId: 1, product: 1 });
loggerSchema.index({ shopId: 1, createdAt: -1 });

let Logger = mongoose.model("Logger", loggerSchema);

export default Logger;

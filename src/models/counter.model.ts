import mongoose, { Schema } from "mongoose";
import { ICounter } from "../types/counter.type";

const counterSchema = new Schema<ICounter>(
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
    value: {
      type: Number,
      required: true,
      default: 0,
    },
  },
  { timestamps: true }
);

// Compound unique: each shop has its own independent billId / transactionId / returnBillId sequence
counterSchema.index({ shopId: 1, name: 1 }, { unique: true });

const Counter = mongoose.model("Counter", counterSchema);

export default Counter;

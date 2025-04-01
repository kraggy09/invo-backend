import mongoose, { Schema } from "mongoose";
import { ICounter } from "../types/counter.type";

const counterSchema = new Schema<ICounter>(
  {
    name: {
      type: String,
      required: true,
      unique: true,
    },
    value: {
      type: Number,
      required: true,
      default: 0,
    },
  },
  { timestamps: true }
);

counterSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 });

const Counter = mongoose.model("Counter", counterSchema);

export default Counter;

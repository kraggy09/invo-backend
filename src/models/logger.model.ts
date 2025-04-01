import mongoose from "mongoose";
import { Schema } from "mongoose";
import { ILogger } from "../types/logger.type";

let loggerSchema = new Schema<ILogger>(
  {
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

let Logger = mongoose.model("Logger", loggerSchema);

export default Logger;

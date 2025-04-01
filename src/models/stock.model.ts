import mongoose, { Schema } from "mongoose";
import moment from "moment-timezone";
import { getCurrentDateAndTime } from "../utils";
import { IStock } from "../types/stock.type";

// Set the timezone to IST
const IST = "Asia/Kolkata";

const stockSchema = new Schema<IStock>({
  date: {
    type: Date,
    default: () => moment.tz(getCurrentDateAndTime(), IST),
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product",
  },
  oldStock: {
    type: Number,
    required: true,
  },
  quantity: {
    type: Number,
    required: true,
  },
  stockAtUpdate: {
    type: Number,
    required: true,
  },
  newStock: {
    type: Number,
    required: true,
  },
  purpose: {
    type: String,
    required: true,
    enum: ["PRODUCT_RETURN", "STOCK_UPDATE"],
  },
});

stockSchema.index({ createdAt: 1 }, { expireAfterSeconds: 5284000 });
const Stock = mongoose.model("Stock", stockSchema);

export default Stock;

import mongoose, { Schema } from "mongoose";
import moment from "moment-timezone";
import { getCurrentDateAndTime, getDate } from "../utils";
import { ITransaction } from "../types/transaction.type";

// Set the timezone to IST
const IST = "Asia/Kolkata";

const newDate = getDate();

const transactionSchema = new Schema<ITransaction>({
  id: {
    type: Number,
    required: true,
    unique: true,
  },
  date: {
    type: String,
    default: newDate,
  },
  previousOutstanding: {
    type: Number,
  },
  newOutstanding: {
    type: Number,
  },
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Customer",
  },
  approved: {
    type: Boolean,
    required: true,
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  name: {
    type: String,
    required: true,
  },
  purpose: {
    type: String,
  },
  amount: {
    required: true,
    type: Number,
  },

  // Depreciating this as this is not a good thing
  taken: {
    // required: true,
    type: Boolean,
  },
  paymentIn: {
    required: true,
    type: Boolean,
  },
  approvedAt: {
    type: Date,
  },
  rejectedAt: {
    type: Date,
  },
  createdAt: {
    type: Date,
    default: () => moment.tz(IST).toDate(),
  },
  paymentMode: {
    type: String,
    enum: ["CASH", "ONLINE", "PRODUCT_RETURN", "ADJUSTMENT"],
    required: true,
  },
}, { timestamps: true });

transactionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 5284000 });

const Transaction = mongoose.model("Transaction", transactionSchema);

export default Transaction;

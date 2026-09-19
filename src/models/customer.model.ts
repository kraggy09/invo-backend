import { ICustomer } from "./../types/customer.type";
import mongoose from "mongoose";

const customerSchema = new mongoose.Schema<ICustomer>({
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
  outstanding: {
    type: Number,
    required: true,
  },
  phone: {
    type: String,
    minlength: 10,
    maxlength: 10,
    required: true,
  },
  idempotencyKey: {
    type: String,
    sparse: true,
    // No longer globally unique — compound index below
  },
}, { timestamps: true });

// Compound indexes for multi-tenancy
customerSchema.index({ shopId: 1, phone: 1 }, { unique: true });
customerSchema.index({ shopId: 1, name: 1 });
customerSchema.index(
  { shopId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: "string" } },
  }
);

const Customer = mongoose.model("Customer", customerSchema);

export default Customer;

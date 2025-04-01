import { ICustomer } from "./../types/customer.type";
import mongoose from "mongoose";
const customerSchema = new mongoose.Schema<ICustomer>({
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
});

const Customer = mongoose.model("Customer", customerSchema);

export default Customer;

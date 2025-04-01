import Customer from "../models/customer.model";
import { Request, Response } from "express";
import ApiResponse from "../utils/ApiResponse";
import Bill from "../models/bill.model";
import Transaction from "../models/transaction.model";

export const createNewCustomer = async (req: Request, res: Response) => {
  try {
    const customerData = req.body;
    let { name, outstanding, phone } = customerData;
    if (phone.length != 10) {
      return ApiResponse(res, 400, false, "Phone number should be of 10 digit");
    }
    name = name.toLowerCase().trim();
    let customer = await Customer.findOne({ name });
    if (customer) {
      return ApiResponse(res, 404, false, "Customer already exists");
    }
    customer = await Customer.findOne({ phone });
    if (customer) {
      return ApiResponse(res, 404, false, "Customer already exists");
    }

    const newCustomer = Customer.create({
      name,
      outstanding,
      phone,
    });

    return ApiResponse(res, 201, true, "Customer created successfully", {
      customer: newCustomer,
    });
  } catch (error: any) {
    return ApiResponse(res, 500, false, error.message || "Server error");
  }
};

export const getAllCustomers = async (req: Request, res: Response) => {
  try {
    const customers = await Customer.find();

    if (customers && customers.length > 0) {
      return ApiResponse(res, 200, true, "List of customers", { customers });
    }

    return ApiResponse(res, 404, false, "No customers found");
  } catch (error: any) {
    return ApiResponse(res, 500, false, "Server error", error.message);
  }
};

export const getSingleCustomer = async (req: Request, res: Response) => {
  const customerId = req.params.customerId; // Access the customer ID from the route parameter

  try {
    const customer = await Customer.findById(customerId);
    if (!customer) {
      return ApiResponse(res, 404, false, "Customer not found");
    }

    let bills = await Bill.find({ customer: customerId }).sort({
      createdAt: 1,
    });

    let transactions = await Transaction.find({
      customer: customerId,
      approved: true,
    }).sort({
      createdAt: 1,
    });

    const newCustomer = { ...customer.toObject(), bills, transactions };

    return ApiResponse(res, 200, true, "Customer found successfully", {
      customer: newCustomer,
    });
  } catch (error: any) {
    console.error("Error fetching customer:", error);
    return ApiResponse(res, 500, false, "Internal Server Error", error.message);
  }
};

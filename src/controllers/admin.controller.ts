import { Request, Response } from "express";
import User from "../models/user.model";
import ApiResponse from "../utils/ApiResponse";
import bcrypt from "bcrypt";
import Bill from "../models/bill.model";
import Transaction from "../models/transaction.model";
import Customer from "../models/customer.model";
import mongoose from "mongoose";

export const addUserToCompany = async (req: Request, res: Response) => {
  try {
    const { name, username, password } = req.body;
    const user = await User.findOne({ username });
    if (user) {
      return ApiResponse(res, 404, false, "User already exists");
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await User.create({
      name,
      username,
      password: hashedPassword,
    });

    if (!newUser) {
      return ApiResponse(res, 400, false, "Unable to create user");
    }

    return ApiResponse(res, 201, true, "User created successfully", {
      user: newUser,
    });
  } catch (error) {
    return ApiResponse(res, 500, false, "Internal Server Error", error);
  }
};

export const getAllUsers = async (req: Request, res: Response) => {
  try {
    const users = await User.find().select("-password");
    if (!users) {
      return ApiResponse(res, 400, false, "No users found");
    }

    return ApiResponse(res, 200, true, "Users found", { users });
  } catch (error) {
    return ApiResponse(res, 500, false, "Internal Server Error", error);
  }
};

export const getAdminData = async (req: Request, res: Response) => {
  try {
    let date = new Date();
    let { days } = req.body;

    // Define date ranges
    const startCurrent = new Date(date.getTime() - days * 24 * 60 * 60 * 1000);
    startCurrent.setHours(0, 0, 0, 0);

    const endCurrent = new Date(date.getTime() - 1 * 24 * 60 * 60 * 1000);
    endCurrent.setHours(23, 59, 59, 999);

    const startPrevious = new Date(
      date.getTime() - days * 2 * 24 * 60 * 60 * 1000
    );
    startPrevious.setHours(0, 0, 0, 0);

    const endPrevious = new Date(
      date.getTime() - (days + 1) * 24 * 60 * 60 * 1000
    );
    endPrevious.setHours(23, 59, 59, 999);

    // Helper function for aggregations
    const aggregateSales = (start: Date, end: Date) => {
      return Bill.aggregate([
        {
          $match: {
            createdAt: {
              $gte: start,
              $lte: end,
            },
          },
        },
        {
          $addFields: {
            BillTotal: {
              $sum: "$items.total", // Sum the total of all items in each document
            },
          },
        },
        {
          $group: {
            _id: "", // Group by empty string to get overall total
            overallSales: {
              $sum: "$BillTotal",
            },
            count: {
              $sum: 1,
            },
          },
        },
      ]);
    };

    // Helper function for transaction aggregations
    const aggregateTransactions = (start: Date, end: Date, taken = false) => {
      return Transaction.aggregate([
        {
          $match: {
            createdAt: {
              $gte: start,
              $lte: end,
            },
            taken: taken,
          },
        },
        {
          $group: {
            _id: "",
            overallPayment: {
              $sum: "$amount",
            },
          },
        },
      ]);
    };

    // Current and Previous Sales Aggregations
    let [totalCurrSales, totalPreviousSales] = await Promise.all([
      aggregateSales(startCurrent, endCurrent),
      aggregateSales(startPrevious, endPrevious),
    ]);

    // Current and Previous Transactions Aggregations
    let [currentTransactions, previousTransaction] = await Promise.all([
      aggregateTransactions(startCurrent, endCurrent),
      aggregateTransactions(startPrevious, endPrevious),
    ]);

    // Daily sales
    let sales = await Bill.aggregate([
      {
        $match: {
          createdAt: {
            $gte: startCurrent,
            $lte: endCurrent,
          },
        },
      },
      {
        $addFields: {
          dateOnly: {
            $dateToString: {
              format: "%m-%d-%Y",
              date: "$date",
            },
          },
        },
      },
      {
        $unwind: "$items",
      },
      {
        $group: {
          _id: "$dateOnly",
          totalAmount: {
            $sum: "$items.total",
          },
        },
      },
      {
        $sort: {
          _id: 1,
        },
      },
    ]);

    // Daily transactions
    let trans = await Transaction.aggregate([
      {
        $match: {
          createdAt: {
            $gte: startCurrent,
            $lte: endCurrent,
          },
          taken: false,
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%m-%d-%Y", date: "$createdAt" },
          },
          totalTrans: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      {
        $sort: {
          _id: 1,
        },
      },
    ]);
    let outstanding = await Customer.aggregate([
      {
        $group: {
          _id: "",
          cash: {
            $sum: "$outstanding",
          },
        },
      },
    ]);

    // Send the aggregated data as response
    return res.status(200).json({
      totalCurrSales,
      totalPreviousSales,
      currentTransactions,
      previousTransaction,
      sales,
      trans,
      outstanding: outstanding[0].cash,
    });
  } catch (error) {
    console.error("Error in getAdminData: ", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

//Todo: Low Priority (Write an aggreagate function to get the profit of the single customer too)

export const getCustomerData = async (req: Request, res: Response) => {
  let { days, customerId } = req.body;
  customerId = new mongoose.Types.ObjectId(customerId);
  let date = new Date();
  const startCurrent = new Date(date.getTime() - days * 24 * 60 * 60 * 1000);
  startCurrent.setHours(0, 0, 0, 0);

  const endCurrent = new Date(date.getTime() - 1 * 24 * 60 * 60 * 1000);
  endCurrent.setHours(23, 59, 59, 999);

  const startPrevious = new Date(
    date.getTime() - days * 2 * 24 * 60 * 60 * 1000
  );
  startPrevious.setHours(0, 0, 0, 0);

  const endPrevious = new Date(
    date.getTime() - (days + 1) * 24 * 60 * 60 * 1000
  );
  endPrevious.setHours(23, 59, 59, 999);

  let foundCustomer = await Customer.findOne({ _id: customerId });

  if (!foundCustomer) {
    return ApiResponse(res, 404, false, "Customer not found");
  }
  // Helper function for aggregations
  const aggregateSales = (start: Date, end: Date) => {
    return Bill.aggregate([
      {
        $match: {
          customer: customerId,
          createdAt: {
            $gte: start,
            $lte: end,
          },
        },
      },
      {
        $addFields: {
          BillTotal: {
            $sum: "$items.total", // Sum the total of all items in each document
          },
        },
      },
      {
        $group: {
          _id: "", // Group by empty string to get overall total
          overallSales: {
            $sum: "$BillTotal",
          },
          count: {
            $sum: 1,
          },
        },
      },
    ]);
  };

  // Helper function for transaction aggregations
  const aggregateTransactions = (start: Date, end: Date, taken = false) => {
    return Transaction.aggregate([
      {
        $match: {
          name: foundCustomer.name,
          createdAt: {
            $gte: start,
            $lte: end,
          },
          taken: taken,
        },
      },
      {
        $group: {
          _id: "",
          overallPayment: {
            $sum: "$amount",
          },
        },
      },
    ]);
  };

  // Current and Previous Sales Aggregations
  let [totalCurrSales, totalPreviousSales] = await Promise.all([
    aggregateSales(startCurrent, endCurrent),
    aggregateSales(startPrevious, endPrevious),
  ]);

  // Current and Previous Transactions Aggregations
  let [currentTransactions, previousTransaction] = await Promise.all([
    aggregateTransactions(startCurrent, endCurrent),
    aggregateTransactions(startPrevious, endPrevious),
  ]);

  // Daily sales
  let sales = await Bill.aggregate([
    {
      $match: {
        customer: customerId,
        createdAt: {
          $gte: startCurrent,
          $lte: endCurrent,
        },
      },
    },
    {
      $addFields: {
        dateOnly: {
          $dateToString: {
            format: "%m-%d-%Y",
            date: "$date",
          },
        },
      },
    },
    {
      $unwind: "$items",
    },
    {
      $group: {
        _id: "$dateOnly",
        totalAmount: {
          $sum: "$items.total",
        },
      },
    },
    {
      $sort: {
        _id: 1,
      },
    },
  ]);

  // Daily transactions
  let trans = await Transaction.aggregate([
    {
      $match: {
        name: foundCustomer.name,
        createdAt: {
          $gte: startCurrent,
          $lte: endCurrent,
        },
        taken: false,
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: "%m-%d-%Y", date: "$createdAt" },
        },
        totalTrans: { $sum: "$amount" },
        count: { $sum: 1 },
      },
    },
    {
      $sort: {
        _id: 1,
      },
    },
  ]);

  console.log({
    totalCurrSales,
    totalPreviousSales,
    currentTransactions,
    previousTransaction,
    sales,
    trans,
  });

  // Send the aggregated data as response
  return res.status(200).json({
    totalCurrSales,
    totalPreviousSales,
    currentTransactions,
    previousTransaction,
    sales,
    trans,
  });
};

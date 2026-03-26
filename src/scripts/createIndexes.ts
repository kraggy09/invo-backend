import mongoose from "mongoose";
import dotenv from "dotenv";
import Bill from "../models/bill.model";
import Transaction from "../models/transaction.model";
import ReturnBill from "../models/returnBill.model";
import Product from "../models/product.model";
import Customer from "../models/customer.model";

dotenv.config();

const createIndexes = async () => {
    try {
        const url = process.env.MONGO_URI;
        if (!url) {
            throw new Error("MONGO_URI not found in environment variables");
        }

        console.log("Connecting to MongoDB...");
        await mongoose.connect(url);
        console.log("Connected successfully.");

        const models = [
            { name: "Bill", model: Bill },
            { name: "Transaction", model: Transaction },
            { name: "ReturnBill", model: ReturnBill },
            { name: "Product", model: Product },
            { name: "Customer", model: Customer },
        ];

        for (const { name, model } of models) {
            console.log(`Creating indexes for ${name}...`);
            // This will use the indexes defined in the schema
            await model.createIndexes();
            console.log(`Successfully created indexes for ${name}.`);
        }

        console.log("All indexes created successfully.");
        process.exit(0);
    } catch (error: any) {
        console.error("Error creating indexes:", error.message);
        process.exit(1);
    }
};

createIndexes();

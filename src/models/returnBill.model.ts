import mongoose, { Schema } from "mongoose";
import moment from "moment-timezone";
import { getCurrentDateAndTime } from "../utils";
import { IReturnBill } from "../types/returnBill.type";

const IST = "Asia/Kolkata";

const returnBillSchema = new Schema<IReturnBill>(
    {
        id: {
            type: Number,
            required: true,
            unique: true,
        },
        date: {
            type: Date,
            default: () => moment.tz(getCurrentDateAndTime(), IST),
        },
        originalBill: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Bill",
            required: true,
        },
        customer: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Customer",
            required: true,
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        items: [
            {
                product: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: "Product",
                    required: true,
                },
                quantityReturned: {
                    type: Number,
                    required: true,
                },
                returnPrice: {
                    type: Number,
                    required: true,
                },
                returnTotal: {
                    type: Number,
                    required: true,
                },
                originalType: {
                    type: String,
                    required: true,
                    enum: ["WHOLESALE", "RETAIL", "SUPERWHOLESALE"],
                },
            },
        ],
        totalAmount: {
            type: Number,
            required: true,
        },
        paymentMode: {
            type: String,
            required: true,
            enum: ["ADJUSTMENT", "CASH"],
        },
        productsTotal: {
            type: Number,
        },
        previousOutstanding: {
            type: Number,
        },
        newOutstanding: {
            type: Number,
        },
        idempotencyKey: {
            type: String,
            unique: true,
            sparse: true,
        },
    },
    { timestamps: true }
);

returnBillSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 24 * 60 * 60 });

const ReturnBill = mongoose.model("ReturnBill", returnBillSchema);

export default ReturnBill;

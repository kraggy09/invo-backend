import mongoose, { Document } from "mongoose";

export interface IReturnItem extends Document {
    product: mongoose.Types.ObjectId | string;
    quantityReturned: number;
    returnPrice: number;
    returnTotal: number;
    originalType: "WHOLESALE" | "RETAIL" | "SUPERWHOLESALE";
}

export interface IReturnBill extends Document {
    id: number;
    date: Date;
    originalBill: mongoose.Types.ObjectId | string;
    customer: mongoose.Types.ObjectId | string;
    createdBy: mongoose.Types.ObjectId | string;
    items: IReturnItem[];
    totalAmount: number;
    paymentMode: "ADJUSTMENT" | "CASH";
    productsTotal?: number;
    previousOutstanding?: number;
    newOutstanding?: number;
    createdAt?: Date;
    updatedAt?: Date;
    idempotencyKey?: string;
}

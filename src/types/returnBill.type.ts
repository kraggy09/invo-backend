import mongoose, { Document } from "mongoose";

export interface IReturnItem extends Document {
    product: mongoose.Types.ObjectId | string;
    quantityReturned: number;
    returnPrice: number;
    returnTotal: number;
    originalType: "WHOLESALE" | "RETAIL" | "SUPERWHOLESALE";
}

export type ReturnBillStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface IReturnBill extends Document {
    shopId?: mongoose.Types.ObjectId;
    id: number;
    date: Date;
    originalBill: mongoose.Types.ObjectId | string;
    customer: mongoose.Types.ObjectId | string;
    createdBy: mongoose.Types.ObjectId | string;
    items: IReturnItem[];
    totalAmount: number;
    paymentMode: "ADJUSTMENT" | "CASH";
    status: ReturnBillStatus;
    approvedBy?: mongoose.Types.ObjectId | string;
    approvedAt?: Date;
    rejectedBy?: mongoose.Types.ObjectId | string;
    rejectedAt?: Date;
    rejectionReason?: string;
    productsTotal?: number;
    previousOutstanding?: number;
    newOutstanding?: number;
    createdAt: Date;
    updatedAt: Date;
    idempotencyKey?: string;
}

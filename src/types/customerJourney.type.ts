import { Document, Types } from "mongoose";

export interface ICustomerJourney extends Document {
    customer: Types.ObjectId;
    action: string;
    description: string;
    user: Types.ObjectId; // User who performed the action
    amount?: number; // Related amount for bills, transactions, returns
    previousOutstanding?: number;
    newOutstanding?: number;
    entityId?: Types.ObjectId; // Ref to specific Bill, Transaction, etc
    metadata?: any;
}

import mongoose, { Schema, Document } from "mongoose";

export interface ITransaction extends Document {
  id: number;
  date?: string;
  previousOutstanding?: number;
  newOutstanding?: number;
  customer?: Schema.Types.ObjectId;
  approved: boolean;
  approvedBy: Schema.Types.ObjectId;
  name: string;
  purpose?: string;
  amount: number;
  taken?: boolean;
  approvedAt?: Date;
  rejectedAt?: Date;
  paymentIn: boolean;
  createdAt?: Date;
  idempotencyKey?: string;
  paymentMode: "CASH" | "ONLINE" | "PRODCT_RETURN";
}

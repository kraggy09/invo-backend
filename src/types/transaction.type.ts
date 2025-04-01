import { Schema, Document } from "mongoose";

export interface ITransaction extends Document {
  id: number;
  date?: string;
  previousOutstanding?: number;
  newOutstanding?: number;
  customer?: Schema.Types.ObjectId;
  approved: boolean;
  approvedBy: boolean;
  name: string;
  purpose?: string;
  amount: number;
  taken?: boolean;
  paymentIn: boolean;
  createdAt?: Date;
  paymentMode: "cash" | "online" | "productReturn";
}

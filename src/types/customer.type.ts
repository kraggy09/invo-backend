import { Document, Types } from "mongoose";
export interface ICustomer extends Document {
  shopId: Types.ObjectId;
  name: string;
  outstanding: number;
  phone: string;
  idempotencyKey?: string;
}

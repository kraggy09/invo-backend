import { Document } from "mongoose";
export interface ICustomer extends Document {
  name: string;
  outstanding: number;
  phone: string;
  idempotencyKey?: string;
}

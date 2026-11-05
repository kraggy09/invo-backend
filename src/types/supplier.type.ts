import { Document, Types } from "mongoose";

export interface ISupplier extends Document {
  shopId: Types.ObjectId;
  name: string;
  phone: string;
  address?: string;
  outstanding: number;
  idempotencyKey?: string;
  createdAt: Date;
  updatedAt: Date;
}


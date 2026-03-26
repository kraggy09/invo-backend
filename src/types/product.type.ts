import { Document } from "mongoose";

export interface IProduct extends Document {
  name: string;
  mrp: number;
  costPrice: number;
  measuring: "kg" | "piece";
  category: string;
  retailPrice: number;
  wholesalePrice: number;
  superWholesalePrice: number;
  barcode: number[];
  stock: number;
  packet: number;
  box: number;
  minQuantity: number;
  hi?: string;
  idempotencyKey?: string;

  // Virtuals
  totalPackets: number;
  totalStock: number;
}

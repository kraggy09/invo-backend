import { Document, Types } from "mongoose";

export interface ISupplierPurchaseItem {
  product: Types.ObjectId;
  quantity: number;
  previousCostPrice?: number;
  newCostPrice?: number;
  previousRetailPrice?: number;
  newRetailPrice?: number;
  previousWholesalePrice?: number;
  newWholesalePrice?: number;
  previousSuperWholesalePrice?: number;
  newSuperWholesalePrice?: number;
  priceUpdated?: boolean;
}

export type SupplierPurchaseStatus = "PENDING" | "ACCEPTED" | "APPROVED" | "REJECTED";
export type SupplierPaymentMode = "CASH" | "CREDIT" | "PARTIAL";

export interface ISupplierPurchase extends Document {
  shopId: Types.ObjectId;
  supplier: Types.ObjectId;
  status: SupplierPurchaseStatus;
  raisedBy: Types.ObjectId;
  raisedAt: Date;
  acceptedBy?: Types.ObjectId;
  acceptedAt?: Date;
  approvedBy?: Types.ObjectId;
  approvedAt?: Date;
  rejectedBy?: Types.ObjectId;
  rejectedAt?: Date;
  items: ISupplierPurchaseItem[];
  totalAmount?: number;
  paymentMode?: SupplierPaymentMode;
  cashPaid?: number;
  creditAmount?: number;
  previousSupplierOutstanding?: number;
  newSupplierOutstanding?: number;
  createdAt: Date;
  updatedAt: Date;
}


import { Response } from "express";
import Supplier from "../models/supplier.model";
import SupplierPurchase from "../models/supplierPurchase.model";
import Transaction from "../models/transaction.model";
import ApiResponse from "../utils/ApiResponse";
import { AuthenticatedRequest } from "../utils/AuthenticatedRequest";
import { EVENTS_MAP } from "../constant/redisMap";

export const createSupplier = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const shopId = req.shopId!;
    let { name, phone, address, outstanding, idempotencyKey } = req.body;

    if (!name || !phone) {
      return ApiResponse(res, 400, false, "Supplier name and phone are required");
    }

    if (idempotencyKey) {
      const existing = await Supplier.findOne({ shopId, idempotencyKey });
      if (existing) {
        return ApiResponse(res, 200, true, "Supplier already exists (Idempotent)", {
          supplier: existing,
        });
      }
    }

    name = name.trim();
    phone = phone.trim();

    const duplicate = await Supplier.findOne({
      shopId,
      $or: [{ phone }, { name: { $regex: `^${name}$`, $options: "i" } }],
    });

    if (duplicate) {
      return ApiResponse(res, 400, false, "Supplier with this name or phone already exists");
    }

    const newSupplier = await Supplier.create({
      shopId,
      name,
      phone,
      address: address || "",
      outstanding: Number(outstanding) || 0,
      idempotencyKey,
    });

    const io = req.app.get("io");
    if (io) {
      io.to(`shop:${shopId}`).emit(EVENTS_MAP.SUPPLIER_CREATED, newSupplier);
    }

    return ApiResponse(res, 201, true, "Supplier created successfully", {
      supplier: newSupplier,
    });
  } catch (error: any) {
    console.error("Error creating supplier:", error);
    return ApiResponse(res, 500, false, error.message || "Server Error");
  }
};

export const getAllSuppliers = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const shopId = req.shopId!;
    const { search } = req.query;

    const query: any = { shopId };
    if (search) {
      const searchStr = String(search).trim();
      query.$or = [
        { name: { $regex: searchStr, $options: "i" } },
        { phone: { $regex: searchStr, $options: "i" } },
      ];
    }

    const suppliers = await Supplier.find(query).sort({ name: 1 }).lean();

    return ApiResponse(res, 200, true, "Suppliers fetched successfully", {
      suppliers,
    });
  } catch (error: any) {
    console.error("Error fetching suppliers:", error);
    return ApiResponse(res, 500, false, error.message || "Server Error");
  }
};

export const getSingleSupplier = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const shopId = req.shopId!;
    const { id } = req.params;

    // Query supplier, purchases and transactions in parallel
    const [supplier, purchases, transactions] = await Promise.all([
      Supplier.findOne({ _id: id, shopId }).lean(),
      SupplierPurchase.find({ shopId, supplier: id })
        .populate("raisedBy", "name username")
        .populate("acceptedBy", "name username")
        .populate("approvedBy", "name username")
        .populate("items.product", "name barcode measuring mrp costPrice retailPrice wholesalePrice superWholesalePrice stock packet box")
        .sort({ createdAt: -1 })
        .limit(100)
        .lean(),
      Transaction.find({ shopId, supplier: id })
        .populate("approvedBy", "name username")
        .sort({ createdAt: -1 })
        .limit(100)
        .lean(),
    ]);

    if (!supplier) {
      return ApiResponse(res, 404, false, "Supplier not found");
    }

    return ApiResponse(res, 200, true, "Supplier retrieved successfully", {
      supplier,
      purchases,
      transactions,
    });
  } catch (error: any) {
    console.error("Error retrieving supplier:", error);
    return ApiResponse(res, 500, false, error.message || "Server Error");
  }
};

export const updateSupplier = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const shopId = req.shopId!;
    const { id } = req.params;
    const { name, phone, address } = req.body;

    const updateData: any = {};
    if (name) updateData.name = name.trim();
    if (phone) updateData.phone = phone.trim();
    if (address !== undefined) updateData.address = address;

    const updatedSupplier = await Supplier.findOneAndUpdate(
      { _id: id, shopId },
      { $set: updateData },
      { new: true }
    );

    if (!updatedSupplier) {
      return ApiResponse(res, 404, false, "Supplier not found");
    }

    const io = req.app.get("io");
    if (io) {
      io.to(`shop:${shopId}`).emit(EVENTS_MAP.SUPPLIER_UPDATED, updatedSupplier);
    }

    return ApiResponse(res, 200, true, "Supplier updated successfully", {
      supplier: updatedSupplier,
    });
  } catch (error: any) {
    console.error("Error updating supplier:", error);
    return ApiResponse(res, 500, false, error.message || "Server Error");
  }
};


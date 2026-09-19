import { Request, Response } from "express";
import Shop from "../models/shop.model";
import ShopMember from "../models/shopMember.model";
import User from "../models/user.model";
import ApiResponse from "../utils/ApiResponse";
import bcrypt from "bcrypt";
import mongoose from "mongoose";
import { AuthenticatedRequest } from "../utils/AuthenticatedRequest";

/**
 * Create a new shop. The creating user becomes SUPER_ADMIN of the shop.
 * This is a platform-level operation.
 */
export const createShop = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      name,
      slug,
      ownerUsername,
      ownerPassword,
      ownerName,
      phone,
      address,
      gstin,
      settings = {},
    } = req.body;

    if (!name || !slug) {
      await session.abortTransaction();
      session.endSession();
      return ApiResponse(res, 400, false, "Shop name and slug are required");
    }

    // Check slug uniqueness
    const existingShop = await Shop.findOne({ slug });
    if (existingShop) {
      await session.abortTransaction();
      session.endSession();
      return ApiResponse(res, 409, false, "A shop with this slug already exists");
    }

    // Find or create owner user
    let owner = await User.findOne({ username: ownerUsername }).session(session);
    if (!owner) {
      if (!ownerPassword) {
        await session.abortTransaction();
        session.endSession();
        return ApiResponse(res, 400, false, "Owner password is required when creating a new user");
      }
      const hashedPassword = await bcrypt.hash(ownerPassword, 10);
      const newOwners = await User.create(
        [{ name: ownerName || ownerUsername, username: ownerUsername, password: hashedPassword }],
        { session }
      );
      owner = newOwners[0];
    }

    // Create the shop
    const shops = await Shop.create(
      [
        {
          name,
          slug,
          owner: owner._id,
          phone,
          address,
          gstin,
          status: "ACTIVE",
          settings: {
            currency: settings.currency || "INR",
            invoicePrefix: settings.invoicePrefix || "INV",
            lowStockAlert: settings.lowStockAlert || 10,
            discordWebhookUrl: settings.discordWebhookUrl || undefined,
          },
        },
      ],
      { session }
    );

    const shop = shops[0];

    // Add owner as SUPER_ADMIN member
    await ShopMember.create(
      [{ shop: shop._id, user: owner._id, roles: ["SUPER_ADMIN"], isActive: true }],
      { session }
    );

    // Initialize counters for this shop
    const Counter = mongoose.model("Counter");
    await Counter.insertMany(
      [
        { shopId: shop._id, name: "billId", value: 1 },
        { shopId: shop._id, name: "transactionId", value: 1 },
        { shopId: shop._id, name: "returnBillId", value: 1 },
      ],
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    return ApiResponse(res, 201, true, "Shop created successfully", {
      shop,
      owner: { _id: owner._id, username: owner.username, name: owner.name },
    });
  } catch (error: any) {
    await session.abortTransaction();
    session.endSession();
    return ApiResponse(res, 500, false, "Internal Server Error", error.message);
  }
};

/**
 * Get all shops (platform admin only).
 */
export const getAllShops = async (_: Request, res: Response) => {
  try {
    const shops = await Shop.find().populate("owner", "name username").lean();
    return ApiResponse(res, 200, true, "Shops retrieved", { shops });
  } catch (error: any) {
    return ApiResponse(res, 500, false, "Internal Server Error", error.message);
  }
};

/**
 * Get the current shop's profile (for authenticated users).
 */
export const getShopProfile = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const shopId = req.shopId!;
    const shop = await Shop.findById(shopId).populate("owner", "name username").lean();
    if (!shop) {
      return ApiResponse(res, 404, false, "Shop not found");
    }
    return ApiResponse(res, 200, true, "Shop profile retrieved", { shop });
  } catch (error: any) {
    return ApiResponse(res, 500, false, "Internal Server Error", error.message);
  }
};

/**
 * Update the current shop's settings.
 */
export const updateShopSettings = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const shopId = req.shopId!;
    const { name, phone, address, gstin, settings } = req.body;

    const updateData: any = {};
    if (name) updateData.name = name;
    if (phone) updateData.phone = phone;
    if (address) updateData.address = address;
    if (gstin) updateData.gstin = gstin;
    if (settings) {
      if (settings.discordWebhookUrl !== undefined) updateData["settings.discordWebhookUrl"] = settings.discordWebhookUrl;
      if (settings.lowStockAlert !== undefined) updateData["settings.lowStockAlert"] = settings.lowStockAlert;
      if (settings.invoicePrefix !== undefined) updateData["settings.invoicePrefix"] = settings.invoicePrefix;
    }

    const updatedShop = await Shop.findByIdAndUpdate(
      shopId,
      { $set: updateData },
      { new: true }
    );

    if (!updatedShop) {
      return ApiResponse(res, 404, false, "Shop not found");
    }

    return ApiResponse(res, 200, true, "Shop settings updated", { shop: updatedShop });
  } catch (error: any) {
    return ApiResponse(res, 500, false, "Internal Server Error", error.message);
  }
};

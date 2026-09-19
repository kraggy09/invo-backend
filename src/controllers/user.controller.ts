import bcrypt from "bcrypt";
import mongoose from "mongoose";
import { Request, Response } from "express";
import User from "../models/user.model";
import Shop from "../models/shop.model";
import ShopMember from "../models/shopMember.model";
import ApiResponse from "../utils/ApiResponse";
import { generateToken } from "../services/token.service";
import { AuthenticatedRequest } from "../utils/AuthenticatedRequest";
import { Types } from "mongoose";

export const checkAuth = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user;
    if (!user || !req.shopId) {
      return ApiResponse(res, 401, false, "Unauthorized");
    }

    const userId = user._id.toString();
    const token = await generateToken(userId, req.shopId.toString());

    // Get active shop memberships for this user
    const memberships = await ShopMember.find({
      user: userId,
      isActive: true,
    }).populate("shop", "name slug status address phone settings");

    // Get current shop info
    const shop = await Shop.findById(req.shopId).select(
      "name slug status address phone settings",
    );

    // roles are already attached to req.user by verifyToken middleware
    const userWithoutPassword = user.toObject();
    delete (userWithoutPassword as any).password;
    return ApiResponse(res, 200, true, "User authenticated successfully", {
      user: {
        ...userWithoutPassword,
        roles: req.shopMember?.roles || [],
        shopId: req.shopId,
        shopName: shop?.name,
        shopAddress: shop?.address || "",
        shopPhone: shop?.phone || "",
        shopSettings: shop?.settings,
      },
      shops: memberships.map((m) => ({
        shopId: (m.shop as any)._id,
        shopName: (m.shop as any).name,
        shopSlug: (m.shop as any).slug,
        roles: m.roles,
      })),
      token,
    });
  } catch (error) {
    console.error("Error in checkAuth:", error);
    return ApiResponse(res, 500, false, "Internal Server Error", error);
  }
};

export const login = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { username, password } = req.body;
    console.log(username, password);

    // Finding user with username
    const user = await User.findOne({ username }).session(session);

    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return ApiResponse(
        res,
        404,
        false,
        "User not found. Kindly check your username.",
      );
    }

    // Checking and throwing error for incorrect password
    const checkPassword = await bcrypt.compare(password, user.password);
    if (!checkPassword) {
      await session.abortTransaction();
      session.endSession();
      return ApiResponse(
        res,
        401,
        false,
        "Incorrect password. Please try again.",
      );
    }

    const userId = user._id.toString();
    console.log(userId, "this is the backend");

    // Find all active shop memberships for this user
    const memberships = await ShopMember.find({
      user: userId,
      isActive: true,
    }).populate("shop", "name slug status address phone settings");

    if (memberships.length === 0) {
      await session.abortTransaction();
      session.endSession();
      return ApiResponse(
        res,
        403,
        false,
        "You are not a member of any active shop. Please contact your administrator.",
      );
    }

    const userWithoutPassword = user.toObject();
    delete (userWithoutPassword as any).password;

    await session.commitTransaction();
    session.endSession();

    // Case 1: User belongs to exactly one shop → auto-login with that shop
    if (memberships.length === 1) {
      const membership = memberships[0];
      const shop = membership.shop as any;
      const token = await generateToken(userId, shop._id.toString());

      return ApiResponse(res, 200, true, "User login successful", {
        user: {
          ...userWithoutPassword,
          roles: membership.roles,
          shopId: shop._id,
          shopName: shop.name,
          shopAddress: shop.address || "",
          shopPhone: shop.phone || "",
          shopSettings: shop.settings,
        },
        shops: memberships.map((m) => ({
          shopId: (m.shop as any)._id,
          shopName: (m.shop as any).name,
          shopSlug: (m.shop as any).slug,
          roles: m.roles,
        })),
        token,
      });
    }

    // Case 2: User belongs to multiple shops → return shop list for selection
    return ApiResponse(
      res,
      200,
      true,
      "Multiple shops found. Please select a shop.",
      {
        requireShopSelection: true,
        userId,
        user: userWithoutPassword,
        shops: memberships.map((m) => ({
          shopId: (m.shop as any)._id,
          shopName: (m.shop as any).name,
          shopSlug: (m.shop as any).slug,
          roles: m.roles,
        })),
      },
    );
  } catch (error: any) {
    console.log(error);

    await session.abortTransaction();
    session.endSession();
    return ApiResponse(res, 500, false, "Internal Server Error", error.message);
  }
};

/**
 * Called after the multi-shop selection modal on the frontend.
 * The user picks a specific shop and we issue a scoped JWT.
 */
export const selectShop = async (req: Request, res: Response) => {
  try {
    const { userId, shopId } = req.body;

    if (!userId || !shopId) {
      return ApiResponse(res, 400, false, "userId and shopId are required");
    }

    const user = await User.findById(userId);
    if (!user) {
      return ApiResponse(res, 404, false, "User not found");
    }

    const membership = await ShopMember.findOne({
      user: userId,
      shop: shopId,
      isActive: true,
    }).populate("shop", "name slug status address phone settings");

    if (!membership) {
      return ApiResponse(
        res,
        403,
        false,
        "You are not an active member of this shop",
      );
    }

    const shop = membership.shop as any;
    if (shop.status !== "ACTIVE") {
      return ApiResponse(
        res,
        403,
        false,
        "This shop is currently inactive or suspended",
      );
    }

    const token = await generateToken(userId, shopId);
    const userWithoutPassword = user.toObject();
    delete (userWithoutPassword as any).password;

    // Also fetch the full list of shops for this user so the UI can show a shop switcher
    const allMemberships = await ShopMember.find({
      user: userId,
      isActive: true,
    }).populate("shop", "name slug status");

    return ApiResponse(res, 200, true, "Shop selected successfully", {
      user: {
        ...userWithoutPassword,
        roles: membership.roles,
        shopId: shop._id,
        shopName: shop.name,
        shopAddress: shop.address || "",
        shopPhone: shop.phone || "",
        shopSettings: shop.settings,
      },
      shops: allMemberships.map((m) => ({
        shopId: (m.shop as any)._id,
        shopName: (m.shop as any).name,
        shopSlug: (m.shop as any).slug,
        roles: m.roles,
      })),
      token,
    });
  } catch (error: any) {
    return ApiResponse(res, 500, false, "Internal Server Error", error.message);
  }
};

/**
 * Switch to a different shop the user is a member of.
 * Validates membership and issues a new scoped JWT.
 */
export const switchShop = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { shopId } = req.body;
    const userId = req.user?._id?.toString() as string;

    if (!shopId) {
      return ApiResponse(res, 400, false, "shopId is required");
    }

    const membership = await ShopMember.findOne({
      user: userId,
      shop: new Types.ObjectId(shopId),
      isActive: true,
    }).populate("shop", "name slug status address phone settings");

    if (!membership) {
      return ApiResponse(
        res,
        403,
        false,
        "You are not an active member of this shop",
      );
    }

    const shop = membership.shop as any;
    if (shop.status !== "ACTIVE") {
      return ApiResponse(
        res,
        403,
        false,
        "This shop is currently inactive or suspended",
      );
    }

    const token = await generateToken(userId, shopId);
    const userWithoutPassword = req.user?.toObject() || {};
    delete (userWithoutPassword as any).password;

    return ApiResponse(res, 200, true, "Shop switched successfully", {
      user: {
        ...userWithoutPassword,
        roles: membership.roles,
        shopId: shop._id,
        shopName: shop.name,
        shopAddress: shop.address || "",
        shopPhone: shop.phone || "",
        shopSettings: shop.settings,
      },
      token,
    });
  } catch (error: any) {
    return ApiResponse(res, 500, false, "Internal Server Error", error.message);
  }
};

export const register = async (req: Request, res: Response) => {
  try {
    const { name, username, password } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return ApiResponse(
        res,
        409,
        false,
        "User already exists. Proceed with login.",
      );
    }

    // Hash the password before saving
    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await User.create({
      name,
      username,
      password: hashedPassword,
    });

    if (!newUser) {
      return ApiResponse(res, 400, false, "Error creating user");
    }

    // Remove password field before sending response
    const userWithoutPassword = newUser.toObject();
    delete (userWithoutPassword as any).password;

    return ApiResponse(res, 201, true, "User created successfully", {
      user: userWithoutPassword,
    });
  } catch (error) {
    return ApiResponse(res, 500, false, "Internal Server Error", error);
  }
};

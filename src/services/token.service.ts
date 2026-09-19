import jwt from "jsonwebtoken";
import ApiResponse from "../utils/ApiResponse";
import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../utils/AuthenticatedRequest";
import User from "../models/user.model";
import ShopMember from "../models/shopMember.model";
import { Types } from "mongoose";

/**
 * Generate a JWT containing both userId and shopId.
 * The shopId is what enables all multi-tenant query scoping.
 */
export const generateToken = async (userId: string, shopId: string) => {
  const secret = process.env.JWT_SECRET as string;
  try {
    const token = jwt.sign({ userId, shopId }, secret, {
      expiresIn: "15d", // Token expires in 15 days
    });
    return token;
  } catch (error) {
    console.error("Error generating token:", error);
    return null;
  }
};

const decodeToken = (token: string): { userId: string; shopId: string } | null => {
  try {
    const secretKey = process.env.JWT_SECRET;
    if (!secretKey) {
      throw new Error("JWT_SECRET is not defined in the environment variables");
    }
    const decoded = jwt.verify(token, secretKey) as {
      userId: string;
      shopId: string;
    };
    return decoded;
  } catch (error) {
    console.error("Error decoding token:", error);
    return null;
  }
};

export const verifyToken = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  const token = req.headers.authorization?.split(" ")[1]; // Extract token from the Authorization header

  if (!token) {
    return ApiResponse(res, 401, false, "Unauthorized");
  }

  const decoded = await decodeToken(token);
  if (!decoded) {
    return ApiResponse(res, 401, false, "Invalid token");
  }

  const user = await User.findById(decoded.userId);
  if (!user) {
    return ApiResponse(res, 401, false, "User not found");
  }

  // Validate that the user is an active member of the shop in the token
  if (!decoded.shopId) {
    return ApiResponse(res, 401, false, "Token missing shop context. Please log in again.");
  }

  const shopMember = await ShopMember.findOne({
    user: decoded.userId,
    shop: decoded.shopId,
    isActive: true,
  });

  if (!shopMember) {
    return ApiResponse(res, 403, false, "You are not an active member of this shop.");
  }

  // Attach multi-tenant context to request
  req.user = user;
  req.user.roles = shopMember.roles; // Roles are now per-shop from ShopMember
  req.shopId = new Types.ObjectId(decoded.shopId);
  req.shopMember = {
    roles: shopMember.roles,
    isActive: shopMember.isActive,
  };

  next();
};


export const isAllowed = (allowedRoles: string[]) => {
  return async (req: AuthenticatedRequest, response: Response, next: NextFunction) => {
    const shopMember = req.shopMember;
    if (!shopMember) {
      return ApiResponse(response, 401, false, "Unauthorized");
    }
    const userRoles = shopMember.roles;
    if (!userRoles) {
      return ApiResponse(response, 401, false, "Unauthorized");
    }

    const isAllowed = allowedRoles.some((role) => userRoles.includes(role));
    if (!isAllowed) {
      return ApiResponse(response, 403, false, "You are not authorized to perform this action");
    }
    next();
  };
};
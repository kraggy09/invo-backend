import jwt from "jsonwebtoken";
import ApiResponse from "../utils/ApiResponse";
import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../utils/AuthenticatedRequest";
import User from "../models/user.model";
import { getAclOfAUser } from "../utils";

export const generateToken = async (userId: string) => {
  const secret = process.env.JWT_SECRET as string;
  try {
    const token = jwt.sign({ userId }, secret, {
      expiresIn: "15d", // Token expires in 15 days
    });
    return token;
  } catch (error) {
    console.error("Error generating token:", error);
    return null;
  }
};

const decodeToken = (token: string): { userId: string } | null => {
  try {
    const secretKey = process.env.JWT_SECRET;
    if (!secretKey) {
      throw new Error("JWT_SECRET is not defined in the environment variables");
    }
    const decoded = jwt.verify(token, secretKey) as {
      userId: string;
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

  // Fetch and attach roles
  const roles = await getAclOfAUser(user._id as string);
  user.roles = roles;

  // Attach user ID to the request object for further use
  req.user = user;
  next();
};


export const isAllowed = (allowedRoles: string[]) => {
  return async (req: AuthenticatedRequest, response: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) {
      return ApiResponse(response, 401, false, "Unauthorized");
    }
    const userRoles = user.roles;
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
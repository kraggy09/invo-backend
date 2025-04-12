import bcrypt from "bcrypt";
import mongoose from "mongoose";
import { Request, Response } from "express";
import User from "../models/user.model";
import ApiResponse from "../utils/ApiResponse";
import { generateToken } from "../services/token.service";
import { AuthenticatedRequest } from "../utils/AuthenticatedRequest";

export const checkAuth = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return ApiResponse(res, 401, false, "Unauthorized");
    }
    const userId = user._id as string;
    const token = await generateToken(userId);
    const userWithoutPassword = user.toObject();
    delete userWithoutPassword.password; // Remove password from the response
    return ApiResponse(res, 200, true, "User authenticated successfully", {
      user: userWithoutPassword,

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
        "User not found. Kindly check your username."
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
        "Incorrect password. Please try again."
      );
    }

    const userId = user._id as string;
    const token = await generateToken(userId);

    const userWithoutPassword = user.toObject();

    await session.commitTransaction();
    session.endSession();

    return ApiResponse(res, 200, true, "User login successful", {
      user: userWithoutPassword,
      token,
    });
  } catch (error: any) {
    console.log(error);

    await session.abortTransaction();
    session.endSession();
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
        "User already exists. Proceed with login."
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

    // Generate token
    const userId = newUser._id as string;
    await generateToken(userId);

    // Remove password field before sending response
    const userWithoutPassword = newUser.toObject();

    return ApiResponse(res, 201, true, "User created successfully", {
      user: userWithoutPassword,
    });
  } catch (error) {
    return ApiResponse(res, 500, false, "Internal Server Error", error);
  }
};

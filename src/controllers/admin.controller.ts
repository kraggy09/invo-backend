import { Request, Response } from "express";
import User from "../models/user.model";
import ApiResponse from "../utils/ApiResponse";
import bcrypt from "bcrypt";

const addUserToCompany = async (req: Request, res: Response) => {
  try {
    const { name, username, password } = req.body;
    const user = await User.findOne({ username });
    if (user) {
      return ApiResponse(res, 404, false, "User already exists");
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await User.create({
      name,
      username,
      password: hashedPassword,
    });

    if (!newUser) {
      return ApiResponse(res, 400, false, "Unable to create user");
    }

    return ApiResponse(res, 201, true, "User created successfully", {
      user: newUser,
    });
  } catch (error) {
    return ApiResponse(res, 500, false, "Internal Server Error", error);
  }
};

export const getAllUsers = async (req: Request, res: Response) => {
  try {
    const users = await User.find().select("-password");
    if (!users) {
      return ApiResponse(res, 400, false, "No users found");
    }

    return ApiResponse(res, 200, true, "Users found", { users });
  } catch (error) {
    return ApiResponse(res, 500, false, "Internal Server Error", error);
  }
};

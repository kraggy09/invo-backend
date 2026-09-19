import { Request } from "express";
import { IUser } from "../types/user.type";
import { Types } from "mongoose";

export interface AuthenticatedRequest extends Request {
  user?: IUser;
  shopId?: Types.ObjectId;
  shopMember?: {
    roles: string[];
    isActive: boolean;
  };
}

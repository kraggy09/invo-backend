import { Request } from "express";
import { IUser } from "../types/user.type";

export interface AuthenticatedRequest extends Request {
  user?: IUser;
}

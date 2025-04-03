import moment from "moment-timezone";
import ACLUser from "../models/aclUser.model";
import { Types } from "mongoose";
import ApiResponse from "./ApiResponse";
import { Response } from "express";

export class ApiError extends Error {
  statusCode: number;
  data?: any;

  constructor(statusCode: number, message: string, data?: any) {
    super(message);
    this.statusCode = statusCode;
    this.data = data;
  }
}

export const getCurrentDateAndTime = () => {
  return moment().tz("Asia/Kolkata").format(); // or format according to your needs
};

export const getDate = () => {
  const IST = "Asia/Kolkata";
  const currentDate = moment().tz(IST).format("DD-MM-YYYY");
  return currentDate;
};

export const getCurrentDateOfUser = (date: Date) => {
  const IST = "Asia/Kolkata";
  const currentDate = moment(date).tz(IST).format("DD-MM-YYYY");
  return currentDate;
};

export const getAclOfAUser = async (userId: string) => {
  const userAclEntries = await ACLUser.find({ user: userId })
    .populate("acl", "name")
    .select("acl");

  const aclNames = userAclEntries
    .map((aclEntry) => {
      if (aclEntry.acl && !(aclEntry.acl instanceof Types.ObjectId)) {
        return aclEntry.acl.name;
      }
      return null;
    })
    .filter(Boolean);
  return aclNames;
};

export const getServerErrorLog = (res: Response, error: any) => {
  if (error instanceof ApiError) {
    return ApiResponse(res, error.statusCode, false, error.message, error.data);
  }
  return ApiResponse(res, 500, false, "Server Error");
};

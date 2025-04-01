import { Response } from "express";

const ApiResponse = (
  res: Response,
  statusCode: number,
  success: boolean,
  msg: string,
  data?: any
): void => {
  res.status(statusCode).json({
    success,
    msg,
    ...(data && { data }),
  });
};

export default ApiResponse;

import { Request, Response } from "express";
import JourneyLog from "../models/journeyLog.model";
import { getServerErrorLog } from "../utils";
import ApiResponse from "../utils/ApiResponse";

export const getJourneyLogs = async (req: Request, res: Response) => {
    try {
        const { page = 1, limit = 50, event, entityType, userId, startDate, endDate } = req.query;

        const query: any = {};
        if (event) query.event = event;
        if (entityType) query.entityType = entityType;
        if (userId) query.user = userId;

        if (startDate && endDate) {
            query.createdAt = {
                $gte: new Date(startDate as string),
                $lte: new Date(endDate as string),
            };
        } else if (startDate) {
            query.createdAt = { $gte: new Date(startDate as string) };
        } else if (endDate) {
            query.createdAt = { $lte: new Date(endDate as string) };
        }

        const logs = await JourneyLog.find(query)
            .populate("user", "name username")
            .sort({ createdAt: -1 })
            .skip((Number(page) - 1) * Number(limit))
            .limit(Number(limit));

        const total = await JourneyLog.countDocuments(query);

        return ApiResponse(res, 200, true, "Journey logs retrieved successfully", {
            logs,
            total,
            page: Number(page),
            limit: Number(limit),
        });
    } catch (error: any) {
        return getServerErrorLog(res, error);
    }
};

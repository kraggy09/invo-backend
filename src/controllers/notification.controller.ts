import { Request, Response } from "express";
import Notification from "../models/notification.model";
import Category from "../models/category.model";
import ApiResponse from "../utils/ApiResponse";
import { ApiError } from "../utils";
import { sendDiscordNotification, formatBillNotification } from "../services/discord.service";
import billEvents, { BILL_EVENTS } from "../events/bill.events";

// Setup background listener
billEvents.on(BILL_EVENTS.BILL_CREATED, async ({ bill, matchingNotifications }) => {
    try {
        for (const match of matchingNotifications.values()) {
            const notificationContent = formatBillNotification({
                ...bill,
                matchingItems: match.items,
                rule: match.rule,
            });
            await sendDiscordNotification(notificationContent);
        }
    } catch (error: any) {
        console.error("Error processing background notification:", error.message);
    }
});

export const createNotification = async (req: Request, res: Response) => {
    try {
        const { name, description, isCustomer, customerId, category } = req.body;
        if (!name || !description || !category) {
            throw new ApiError(400, "Missing required fields");
        }

        const newNotification = await Notification.create({
            name,
            description,
            isCustomer: isCustomer || false,
            customerId,
            category,
        });

        return ApiResponse(res, 201, true, "Notification rule created", {
            notification: newNotification,
        });
    } catch (error: any) {
        if (error instanceof ApiError) {
            return ApiResponse(res, error.statusCode, false, error.message);
        }
        return ApiResponse(res, 500, false, error.message || "Server Error");
    }
};

export const getNotifications = async (req: Request, res: Response) => {
    try {
        const notifications = await Notification.find()
            .populate("customerId", "name")
            .populate("category", "name");
        return ApiResponse(res, 200, true, "Notifications retrieved", {
            notifications,
        });
    } catch (error: any) {
        return ApiResponse(res, 500, false, error.message || "Server Error");
    }
};

export const deleteNotification = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const deleted = await Notification.findByIdAndDelete(id);
        if (!deleted) {
            throw new ApiError(404, "Notification not found");
        }
        return ApiResponse(res, 200, true, "Notification deleted");
    } catch (error: any) {
        if (error instanceof ApiError) {
            return ApiResponse(res, error.statusCode, false, error.message);
        }
        return ApiResponse(res, 500, false, error.message || "Server Error");
    }
};

export const getNotificationRules = async (customerId?: string) => {
    try {
        const query: any = customerId
            ? { $or: [{ isCustomer: false }, { customerId }] }
            : { isCustomer: false };

        return await Notification.find(query).populate("category", "name");
    } catch (error: any) {
        console.error("Error fetching notification rules:", error.message);
        return [];
    }
};

export const checkAndSendNotifications = async (bill: any) => {
    // This remains as a fallback or for other uses, but we'll use the optimized flow in createBill
    try {
        const rules = await getNotificationRules(bill.customer?._id || bill.customer);
        for (const rule of rules) {
            const categoryName = (rule.category as any)?.name?.toLowerCase();
            if (!categoryName) continue;

            const matchingItems = bill.items.filter((item: any) => {
                const productCategory = (item.productSnapshot?.category || item.product?.category)?.toLowerCase();
                return productCategory === categoryName;
            });

            if (matchingItems.length > 0) {
                const notificationContent = formatBillNotification({
                    ...bill,
                    matchingItems
                });
                await sendDiscordNotification(notificationContent);
            }
        }
    } catch (error: any) {
        console.error("Error checking notifications:", error.message);
    }
};

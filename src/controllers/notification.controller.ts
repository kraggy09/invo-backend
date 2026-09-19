import { Response } from "express";
import Notification from "../models/notification.model";
import Category from "../models/category.model";
import ApiResponse from "../utils/ApiResponse";
import { ApiError } from "../utils";
import {
  sendDiscordNotification,
  formatBillNotification,
} from "../services/discord.service";
import billEvents, { BILL_EVENTS } from "../events/bill.events";
import { AuthenticatedRequest } from "../utils/AuthenticatedRequest";
import Shop from "../models/shop.model";
import { Types } from "mongoose";

// Setup background listener — now receives shopId with the event
billEvents.on(
  BILL_EVENTS.BILL_CREATED,
  async ({ bill, shopId, matchingNotifications }) => {
    try {
      // Get shop-specific Discord webhook URL
      const shop = await Shop.findById(shopId).select(
        "settings.discordWebhookUrl",
      );
      const webhookUrl = shop?.settings?.discordWebhookUrl;

      for (const match of matchingNotifications.values()) {
        const notificationContent = formatBillNotification({
          ...bill,
          matchingItems: match.items,
          rule: match.rule,
        });
        await sendDiscordNotification(notificationContent, webhookUrl);
      }
    } catch (error: any) {
      console.error("Error processing background notification:", error.message);
    }
  },
);

export const createNotification = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const shopId = req.shopId!;
    const { name, description, isCustomer, customerId, category } = req.body;
    if (!name || !description || !category) {
      throw new ApiError(400, "Missing required fields");
    }

    const newNotification = await Notification.create({
      shopId,
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

export const getNotifications = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const shopId = req.shopId!;
    const notifications = await Notification.find({ shopId })
      .populate("customerId", "name")
      .populate("category", "name");
    return ApiResponse(res, 200, true, "Notifications retrieved", {
      notifications,
    });
  } catch (error: any) {
    return ApiResponse(res, 500, false, error.message || "Server Error");
  }
};

export const deleteNotification = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const shopId = req.shopId!;
    const { id } = req.params;
    // IDOR prevention: must belong to this shop
    const deleted = await Notification.findOneAndDelete({ _id: id, shopId });
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

/**
 * Fetch notification rules SCOPED to the shop.
 * This is called from bill.controller.ts createBill.
 */
export const getNotificationRules = async (
  customerId?: string,
  shopId?: Types.ObjectId,
) => {
  try {
    const query: any = shopId ? { shopId } : {};
    if (customerId) {
      query.$or = [{ isCustomer: false }, { customerId }];
    } else {
      query.isCustomer = false;
    }

    return await Notification.find(query).populate("category", "name");
  } catch (error: any) {
    console.error("Error fetching notification rules:", error.message);
    return [];
  }
};

export const checkAndSendNotifications = async (bill: any) => {
  try {
    const rules = await getNotificationRules(
      bill.customer?._id || bill.customer,
      bill.shopId,
    );
    for (const rule of rules) {
      const categoryName = (rule.category as any)?.name?.toLowerCase();
      if (!categoryName) continue;

      const matchingItems = bill.items.filter((item: any) => {
        const productCategory = (
          item.productSnapshot?.category || item.product?.category
        )?.toLowerCase();
        return productCategory === categoryName;
      });

      if (matchingItems.length > 0) {
        const notificationContent = formatBillNotification({
          ...bill,
          matchingItems,
        });
        await sendDiscordNotification(notificationContent);
      }
    }
  } catch (error: any) {
    console.error("Error checking notifications:", error.message);
  }
};

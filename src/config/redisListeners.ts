import { EVENTS_MAP } from "../constant/redisMap";
import { subClient } from "./redis.config";
import { Server as SocketIOServer } from "socket.io";

// Regular user events
const REDIS_EVENTS_TO_SUBSCRIBE = [
  EVENTS_MAP.BILL_CREATED,
  EVENTS_MAP.TRANSACTION_CREATED,
  EVENTS_MAP.CATEGORY_CREATED,
  EVENTS_MAP.CATEGORY_UPDATED,
  EVENTS_MAP.PRODUCT_CREATED,
  EVENTS_MAP.PRODUCT_UPDATED,
  EVENTS_MAP.STOCK_UPDATED,
  EVENTS_MAP.TRANSACTION_APPROVED,
];

// Admin-only events
const ADMIN_EVENTS_TO_SUBSCRIBE = [
  EVENTS_MAP.BILL_CREATION_NOTIFICATION,
  EVENTS_MAP.TRANSACTION_CREATION_NOTIFICATION,
  EVENTS_MAP.STOCK_REQUEST_RAISED_NOTIFICATION,
];

const setupRedisListeners = async (io: SocketIOServer) => {
  try {
    await subClient.subscribe("welcome", (message) => {
      try {
        const data = JSON.parse(message);
        io.to(data.socketId).emit("welcome", data);
      } catch (err) {
        console.error("❌ Failed to parse message for welcome:", err);
      }
    });

    for (const event of REDIS_EVENTS_TO_SUBSCRIBE) {
      await subClient.subscribe(event, (message) => {
        try {
          const data = JSON.parse(message) as { socketId: string };
          io.except(data.socketId).emit(event, data);
        } catch (err) {
          console.error(`❌ Failed to parse message for ${event}:`, err);
        }
      });
    }

    // Admin-specific events
    for (const event of ADMIN_EVENTS_TO_SUBSCRIBE) {
      await subClient.subscribe(event, (message) => {
        try {
          const data = JSON.parse(message);
          io.to("admin").emit(event, data);
        } catch (err) {
          console.error(`❌ Failed to parse admin message for ${event}:`, err);
        }
      });
    }

    console.log("✅ Redis subscriptions set up successfully!");
  } catch (error) {
    console.error("❌ Error setting up Redis subscriptions:", error);
  }
};

export default setupRedisListeners;

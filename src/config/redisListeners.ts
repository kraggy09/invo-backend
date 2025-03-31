import { subClient } from "./redis.config";
import { Server as SocketIOServer } from "socket.io";

const setupRedisListeners = async (io: SocketIOServer) => {
  try {
  } catch (error) {
    console.error("❌ Error setting up Redis subscriptions:", error);
  }
};

export default setupRedisListeners;

import { Server as SocketIOServer } from "socket.io";
import { Server as HttpServer } from "http";
import { pubClient, subClient } from "./redis.config";
import { createAdapter } from "@socket.io/redis-adapter";
import setupSocketHandlers from "../sockets/index";
import setupRedisListeners from "./redisListeners";

const configureSocketIO = async (server: HttpServer) => {
  try {
    const io = new SocketIOServer(server, {
      cors: {
        origin: "*",
      },
      path: "/socket.io",
      adapter: createAdapter(pubClient, subClient),
    });

    console.log("🚀 Socket.IO is successfully initialized!");
    // Socket handlers
    setupSocketHandlers(io);
    // Redis Listeners
    setupRedisListeners(io);
    return io;
  } catch (error) {
    console.error("❌ Error initializing Socket.IO:", error);
    throw error; // Ensure the error is propagated
  }
};

export default configureSocketIO;

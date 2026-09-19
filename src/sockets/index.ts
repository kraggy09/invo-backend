import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { pubClient } from "../config/redis.config";
import ShopMember from "../models/shopMember.model";
import { Types } from "mongoose";

const setupSocketHandlers = (io: Server) => {
  io.on("connection", async (socket) => {
    console.log(`✅ New client connected: ${socket.id}`);
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;

    let userId: string | null = null;
    let shopId: string | null = null;

    if (token) {
      try {
        const secretKey = process.env.JWT_SECRET as string;
        const decoded = jwt.verify(token, secretKey) as { userId: string; shopId: string };
        userId = decoded.userId;
        shopId = decoded.shopId;
      } catch (error) {
        console.error("Socket token verification failed:", error);
      }
    }

    // Validate active shop membership before joining room
    if (userId && shopId) {
      const membership = await ShopMember.findOne({
        user: new Types.ObjectId(userId),
        shop: new Types.ObjectId(shopId),
        isActive: true,
      });

      if (membership) {
        // Join the shop-specific room — all broadcasts are isolated per shop
        await socket.join(`shop:${shopId}`);
        // Join user-specific room for targeted messages
        await socket.join(`user:${userId}`);
        console.log(`🏪 User ${userId} joined shop room: shop:${shopId}`);
      } else {
        console.warn(`⚠️ User ${userId} attempted to join shop:${shopId} but is not an active member.`);
        socket.emit("ERROR", { message: "Not an active member of this shop." });
      }
    }

    if (userId) {
      const existingSocketId = await pubClient.get(`user_socket:${userId}`);

      if (existingSocketId && existingSocketId !== socket.id) {
        // Check if existing socket is actually connected in this server or other nodes
        const sockets = await io.in(existingSocketId).fetchSockets();
        if (sockets.length > 0) {
          console.log(`User ${userId} already has an active session on socket ${existingSocketId}`);
          setTimeout(() => {
            socket.emit("SESSION_ALREADY_ACTIVE", { message: "Connection active in another tab" });
          }, 1000);
        } else {
          // Stale connection in Redis
          await pubClient.set(`user_socket:${userId}`, socket.id, "EX", 86400);
          setTimeout(() => {
            socket.emit("welcome", { socketId: socket.id, token });
          }, 1000);
        }
      } else {
        // No existing socket or same socket
        await pubClient.set(`user_socket:${userId}`, socket.id, "EX", 86400);
        setTimeout(() => {
          socket.emit("welcome", { socketId: socket.id, token });
        }, 1000);
      }
    } else {
      setTimeout(() => {
        socket.emit("welcome", { socketId: socket.id, token });
      }, 1000);
    }

    socket.on("FORCE_SESSION", async () => {
      if (userId) {
        const oldSocketId = await pubClient.get(`user_socket:${userId}`);
        if (oldSocketId && oldSocketId !== socket.id) {
          // Terminate old session
          io.to(oldSocketId).emit("SESSION_TERMINATED", { message: "Session moved to another tab" });

          const oldSockets = await io.in(oldSocketId).fetchSockets();
          for (const oldSocket of oldSockets) {
            oldSocket.disconnect(true);
          }
        }

        // Register this socket
        await pubClient.set(`user_socket:${userId}`, socket.id, "EX", 86400);

        // Re-join rooms with the new socket
        if (shopId) {
          await socket.join(`shop:${shopId}`);
          await socket.join(`user:${userId}`);
        }

        socket.emit("welcome", { socketId: socket.id, token });
      }
    });

    // Handle shop switching — client reconnects with new token, but we also support
    // the SWITCH_SHOP event for seamless room switching without full reconnect
    socket.on("SWITCH_SHOP", async (data: { newShopId: string; newToken: string }) => {
      if (!userId || !data.newShopId || !data.newToken) return;

      try {
        const secretKey = process.env.JWT_SECRET as string;
        const decoded = jwt.verify(data.newToken, secretKey) as { userId: string; shopId: string };

        if (decoded.userId !== userId) {
          socket.emit("ERROR", { message: "Token mismatch. Cannot switch shop." });
          return;
        }

        // Validate membership in new shop
        const membership = await ShopMember.findOne({
          user: new Types.ObjectId(decoded.userId),
          shop: new Types.ObjectId(decoded.shopId),
          isActive: true,
        });

        if (!membership) {
          socket.emit("ERROR", { message: "Not an active member of target shop." });
          return;
        }

        // Leave old shop room, join new shop room
        if (shopId) {
          await socket.leave(`shop:${shopId}`);
        }
        shopId = decoded.shopId;
        await socket.join(`shop:${shopId}`);

        socket.emit("SHOP_SWITCHED", { shopId: decoded.shopId });
        console.log(`🔄 User ${userId} switched to shop room: shop:${shopId}`);
      } catch (error) {
        socket.emit("ERROR", { message: "Failed to switch shop. Invalid token." });
      }
    });

    socket.on("disconnect", async () => {
      console.log(`❌ Client disconnected: ${socket.id}`);
      if (userId) {
        const currentSocketId = await pubClient.get(`user_socket:${userId}`);
        if (currentSocketId === socket.id) {
          await pubClient.del(`user_socket:${userId}`);
        }
      }
    });
  });
};

export default setupSocketHandlers;

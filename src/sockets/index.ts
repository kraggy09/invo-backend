import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { pubClient } from "../config/redis.config";

const setupSocketHandlers = (io: Server) => {
  io.on("connection", async (socket) => {
    console.log(`✅ New client connected: ${socket.id}`);
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;

    let userId: string | null = null;
    if (token) {
      try {
        const secretKey = process.env.JWT_SECRET as string;
        const decoded = jwt.verify(token, secretKey) as { userId: string };
        userId = decoded.userId;
      } catch (error) {
        console.error("Socket token verification failed:", error);
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
        socket.emit("welcome", { socketId: socket.id, token });
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

import { Server } from "socket.io";
import { pubClient } from "../config/redis.config";

const setupSocketHandlers = (io: Server) => {
  io.on("connection", (socket) => {
    console.log(`✅ New client connected: ${socket.id}`);
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    pubClient.publish(
      "welcome",
      JSON.stringify({ socketId: socket.id, token })
    );
    socket.on("disconnect", () => {
      console.log(`❌ Client disconnected: ${socket.id}`);
    });
  });
};

export default setupSocketHandlers;

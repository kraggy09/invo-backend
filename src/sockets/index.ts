import { Server } from "socket.io";

const setupSocketHandlers = (io: Server) => {
  io.on("connection", (socket) => {
    console.log(`✅ New client connected: ${socket.id}`);
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;

    socket.on("disconnect", () => {
      console.log(`❌ Client disconnected: ${socket.id}`);
    });
  });
};

export default setupSocketHandlers;

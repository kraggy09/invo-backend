import { Server } from "socket.io";

const setupSocketHandlers = (io: Server) => {
  io.on("connection", (socket) => {
    console.log(`✅ New client connected: ${socket.id}`);
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;

    setTimeout(() => {
      socket.emit("welcome", { socketId: socket.id, token });
    }, 1000);
    socket.on("disconnect", () => {
      console.log(`❌ Client disconnected: ${socket.id}`);
    });
  });
};

export default setupSocketHandlers;

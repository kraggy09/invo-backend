import app from "./app";
import http from "http";
import configureSocketIO from "./config/socket.config";
const PORT = process.env.PORT || 5000;
import {} from "crypto";

export const instanceId = crypto.randomUUID();
const server = http.createServer(app);
server.listen(PORT, async () => {
  console.log(`🚀 Server is listening on PORT ${PORT}`);
  console.log(`🚀 Instance ID: ${instanceId}`);

  try {
    const io = await configureSocketIO(server);
    console.log("✅ Socket.IO configured successfully!");

    io.on("connection", (socket) => {
      console.log(`✅ New client connected: ${socket.id}`);

      socket.on("disconnect", () => {
        console.log(`❌ Client disconnected: ${socket.id}`);
      });
    });
  } catch (error) {
    console.error("❌ Error configuring Socket.IO:", error);
  }
});

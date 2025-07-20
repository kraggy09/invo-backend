import app from "./app";
import http from "http";
import configureSocketIO from "./config/socket.config";
import setupSocketHandlers from "./sockets";
import connection from "./db/dbConfig";
const PORT = process.env.PORT || 5000;
const url = process.env.MONGODB_URI as string;

export const instanceId = crypto.randomUUID();
const server = http.createServer(app);
server.listen(PORT, async () => {
  console.log(`🚀 Server is listening on PORT ${PORT}`);
  console.log(`🚀 Instance ID: ${instanceId}`);

  try {
    await connection(url);
    const io = await configureSocketIO(server);
    app.set("io", io);
    console.log("✅ Socket.IO configured successfully!");

    setupSocketHandlers(io);
  } catch (error) {
    console.error("❌ Error configuring Socket.IO:", error);
  }
});

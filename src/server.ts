import app from "./app";
import http from "http";
import configureSocketIO from "./config/socket.config";
import setupSocketHandlers from "./sockets";
import connection from "./db/dbConfig";
import { initJourneyWorker } from "./workers/journeyWorker";

const PORT = process.env.PORT || 3000;
const url = process.env.MONGO_URI as string;

const server = http.createServer(app);
server.listen(PORT, async () => {
  console.log(`🚀 Server is listening on PORT ${PORT}`);

  try {
    await connection(url);
    const io = await configureSocketIO(server);
    app.set("io", io);
    console.log("✅ Socket.IO configured successfully!");

    setupSocketHandlers(io);
    initJourneyWorker(io);
  } catch (error) {

    console.error("❌ Error configuring Socket.IO:", error);
  }
});

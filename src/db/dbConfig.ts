import dns from "dns";
import mongoose from "mongoose";

// Force Google & Cloudflare DNS to reliably resolve MongoDB Atlas SRV records
dns.setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1"]);

const connection = async (url: string) => {
  try {
    const conn = mongoose.connection;
    conn.on("error", (err) => {
      console.log("There was an error while connecting in mongodb", err);
    });

    await mongoose.connect(String(url));
    console.log("✅ MongoDb connected successfully");
  } catch (error: any) {
    console.log("Something went wrong", error.message);
  }
};

export default connection;

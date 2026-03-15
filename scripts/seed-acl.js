const mongoose = require("mongoose");
require("dotenv").config();

const aclSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String, required: true },
});

const ACL = mongoose.model("ACL", aclSchema);

const aclDocs = [
    {
        name: "CREATOR",
        description: "Creator is the most supreme who created the app, and have all the full access",
    },
    {
        name: "ADMIN",
        description: "Administrator with full access to manage users, billing, and system settings.",
    },
    {
        name: "SUPER_ADMIN",
        description: "Super Administrator with unrestricted access to all modules including ACL management.",
    },
    {
        name: "WORKER",
        description: "Worker with limited access to perform day-to-day operations like billing and stock updates.",
    },
    {
        name: "SPECIAL_RIGHTS",
        description: "Custom role with elevated privileges for specific operations beyond a standard worker.",
    },
];

async function seed() {
    try {
        const uri = process.env.MONGO_URI;
        if (!uri) {
            throw new Error("MONGO_URI not found in environment variables");
        }

        await mongoose.connect(uri);
        console.log("✅ Connected to MongoDB");

        // Avoid duplicates by upserting on name
        for (const doc of aclDocs) {
            await ACL.findOneAndUpdate(
                { name: doc.name },
                doc,
                { upsert: true, new: true }
            );
            console.log(`✅  Upserted ACL: ${doc.name}`);
        }

        console.log("\n🎉 ACL seeding complete!");
    } catch (err) {
        console.error("❌ Seeding failed:", err.message);
    } finally {
        await mongoose.disconnect();
        console.log("🔌 Disconnected from MongoDB");
    }
}

seed();

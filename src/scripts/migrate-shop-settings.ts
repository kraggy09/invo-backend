/**
 * Migration Script: Shop Settings (pricingMode & printType)
 *
 * SAFETY GUARANTEES:
 * - Idempotent: safe to run multiple times
 * - Non-destructive: only sets default values for missing settings fields
 * - Existing shops get pricingMode: "MULTI_TIER" and printType: "THERMAL"
 *
 * Usage:
 *   npm run migrate:settings
 */

import dns from "dns";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

// Fix for Node.js SRV DNS resolution on certain networks
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const MONGODB_URI =
  process.env.MONGO_URI ||
  process.env.MONGODB_URI ||
  "mongodb://127.0.0.1:27017/invosync";

async function migrate() {
  console.log("=======================================================");
  console.log("       🔄  MIGRATION: SHOP SETTINGS INITIALIZATION     ");
  console.log("=======================================================\n");

  console.log("⏳ Connecting to MongoDB...");
  await mongoose.connect(MONGODB_URI);
  console.log("✅ Connected to MongoDB\n");

  const db = mongoose.connection.db!;
  const shopsCol = db.collection("shops");
  const categoriesCol = db.collection("categories");

  // Step 1: Migrate Shop Settings
  console.log("📋 Step 1: Scanning shops for settings migration...");
  const shops = await shopsCol.find({}).toArray();
  console.log(`Found ${shops.length} shop(s) in total.\n`);

  let updatedCount = 0;
  let skippedCount = 0;

  for (const shop of shops) {
    const settings = shop.settings || {};
    const updates: Record<string, any> = {};

    if (!settings.pricingMode) {
      updates["settings.pricingMode"] = "MULTI_TIER";
    }
    if (!settings.printType) {
      updates["settings.printType"] = "THERMAL";
    }

    if (Object.keys(updates).length > 0) {
      await shopsCol.updateOne({ _id: shop._id }, { $set: updates });
      console.log(
        `   ✅ Updated shop "${shop.name}" (${shop._id}): ${JSON.stringify(
          updates
        )}`
      );
      updatedCount++;
    } else {
      console.log(`   ⏭️  Shop "${shop.name}" (${shop._id}) already configured`);
      skippedCount++;
    }
  }

  // Step 2: Clean up any corrupted categories ("null" or "nan")
  console.log("\n📋 Step 2: Checking for accidental 'null' or 'nan' categories...");
  const cleanResult = await categoriesCol.deleteMany({
    name: { $in: ["null", "nan", "undefined"] },
  });
  if (cleanResult.deletedCount > 0) {
    console.log(`   🧹 Removed ${cleanResult.deletedCount} corrupted category document(s).`);
  } else {
    console.log("   ✅ No corrupted categories found.");
  }

  console.log("\n=======================================================");
  console.log("🎉 Migration Completed Successfully!");
  console.log(`   Total Shops:    ${shops.length}`);
  console.log(`   Updated:        ${updatedCount}`);
  console.log(`   Already Set:    ${skippedCount}`);
  console.log(`   Cleaned Cats:   ${cleanResult.deletedCount}`);
  console.log("=======================================================\n");
}

async function main() {
  try {
    await migrate();
  } catch (err) {
    console.error("❌ Migration failed:", err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

main();

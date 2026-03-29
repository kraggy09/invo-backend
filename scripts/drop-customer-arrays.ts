/**
 * Migration: Drop legacy `bills` and `transactions` arrays from Customer documents.
 *
 * These arrays stored raw IDs from the old "bill-quil" era and are no longer
 * referenced by any code. This script safely removes them from every customer
 * document in the collection using a single bulk $unset.
 *
 * Run with:
 *   npx ts-node scripts/drop-customer-arrays.ts
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const MONGO_URI = process.env.MONGO_URI!;

async function main() {
    if (!MONGO_URI) {
        console.error("❌ MONGO_URI not found in .env");
        process.exit(1);
    }

    await mongoose.connect(MONGO_URI);
    console.log("✅ Connected to MongoDB");

    const db = mongoose.connection.db!;
    const collection = db.collection("customers");

    // Dry-run: count how many documents still have these fields
    const [withBills, withTransactions] = await Promise.all([
        collection.countDocuments({ bills: { $exists: true } }),
        collection.countDocuments({ transactions: { $exists: true } }),
    ]);

    console.log(`\n📊 Documents with legacy 'bills' array:        ${withBills}`);
    console.log(`📊 Documents with legacy 'transactions' array: ${withTransactions}`);

    if (withBills === 0 && withTransactions === 0) {
        console.log("\n✅ Nothing to clean up — fields already absent. Exiting.");
        await mongoose.disconnect();
        return;
    }

    // Drop both fields from ALL customer documents in one operation
    const result = await collection.updateMany(
        { $or: [{ bills: { $exists: true } }, { transactions: { $exists: true } }] },
        { $unset: { bills: "", transactions: "" } }
    );

    console.log(`\n🗑️  Matched:  ${result.matchedCount} documents`);
    console.log(`✅ Modified: ${result.modifiedCount} documents`);
    console.log("\n🎉 Legacy arrays removed successfully.");

    await mongoose.disconnect();
}

main().catch((err) => {
    console.error("❌ Migration failed:", err);
    process.exit(1);
});

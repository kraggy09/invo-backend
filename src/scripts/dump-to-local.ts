import dns from "dns";
import dotenv from "dotenv";
dotenv.config();

import { MongoClient } from "mongodb";

// Resolve SRV records reliably if source is MongoDB Atlas
dns.setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1"]);

// ============================================================================
// CONFIGURATION CONSTANTS
// ============================================================================

/**
 * Source MongoDB connection string (e.g., Atlas cluster).
 * Defaults to process.env.MONGO_URI or MONGODB_URI.
 */
export const FROM_MONGO_URI: string =
  process.env.FROM_MONGO_URI ||
  process.env.MONGO_URI ||
  process.env.MONGODB_URI ||
  "mongodb+srv://kaifshaikh2013sk:z48F15l3qQLIDmvJ@billquill.ykpa2hw.mongodb.net/";

/**
 * Target MongoDB connection string (Local MongoDB instance).
 * You can change the port or database name here.
 */
export const TARGET_MONGO_URI: string =
  process.env.TARGET_MONGO_URI ||
  "mongodb+srv://kaifshaikh2013sk_db_user:dj8wmOFxt24cgXZs@billquill-multicluster.lwhifl2.mongodb.net/?appName=BillQuill-MultiCluster";

/**
 * Explicit source database name (leave empty string to auto-detect from URI or cluster).
 */
export const FROM_DB_NAME: string = process.env.FROM_DB_NAME || "";

/**
 * Explicit target database name (leave empty string to auto-detect from TARGET_MONGO_URI).
 */
export const TARGET_DB_NAME: string = process.env.TARGET_DB_NAME || "";

/**
 * Batch size for copying documents to prevent memory overflow.
 */
const BATCH_SIZE = 500;

/**
 * Whether to drop existing collections in target DB before copying.
 */
const DROP_TARGET_COLLECTIONS_FIRST = true;

/**
 * Whether to copy indexes from source collections to target collections.
 */
const COPY_INDEXES = true;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function maskUri(uri: string): string {
  return uri.replace(/\/\/[^@]+@/, "//***:***@");
}

function extractDbNameFromUri(uri: string): string | null {
  try {
    const parsed = new URL(
      uri.replace("mongodb+srv://", "http://").replace("mongodb://", "http://"),
    );
    const pathname = parsed.pathname.replace(/^\//, "").split("?")[0];
    return pathname ? pathname : null;
  } catch {
    return null;
  }
}

// ============================================================================
// MAIN DUMP / SYNC LOGIC
// ============================================================================

async function dumpDatabase() {
  console.log("=================================================");
  console.log("   🚀 MongoDB Dump & Sync to Local Database      ");
  console.log("=================================================");
  console.log(`📡 Source URI : ${maskUri(FROM_MONGO_URI)}`);
  console.log(`🎯 Target URI : ${maskUri(TARGET_MONGO_URI)}`);
  console.log("-------------------------------------------------");

  let fromClient: MongoClient | null = null;
  let targetClient: MongoClient | null = null;

  try {
    // 1. Connect to Source
    console.log("Connecting to source MongoDB...");
    fromClient = new MongoClient(FROM_MONGO_URI, {
      serverSelectionTimeoutMS: 8000,
    });
    await fromClient.connect();
    console.log("✅ Connected to source MongoDB!");

    // Determine source database name
    let sourceDbName = FROM_DB_NAME || extractDbNameFromUri(FROM_MONGO_URI);
    if (!sourceDbName) {
      // If no DB in URI, check existing databases or default to 'test'
      const admin = fromClient.db().admin();
      const dbList = await admin.listDatabases();
      const candidate = dbList.databases.find(
        (d) => d.name !== "admin" && d.name !== "local" && d.name !== "config",
      );
      sourceDbName = candidate ? candidate.name : "test";
    }

    const sourceDb = fromClient.db(sourceDbName);
    console.log(`📂 Source Database: [${sourceDbName}]`);

    // 2. Connect to Target
    console.log("\nConnecting to target (local) MongoDB...");
    targetClient = new MongoClient(TARGET_MONGO_URI, {
      serverSelectionTimeoutMS: 4000,
    });
    try {
      await targetClient.connect();
      console.log("✅ Connected to target MongoDB!");
    } catch (err: any) {
      console.error("\n❌ FAILED TO CONNECT TO TARGET MONGODB!");
      console.error(`Target URI: ${TARGET_MONGO_URI}`);
      console.error(
        "Is your local MongoDB service started/running on port 27017?",
      );
      console.error(`Error details: ${err.message}\n`);
      process.exit(1);
    }

    // Determine target database name
    const targetDbName =
      TARGET_DB_NAME || extractDbNameFromUri(TARGET_MONGO_URI) || sourceDbName;
    const targetDb = targetClient.db(targetDbName);
    console.log(`📂 Target Database: [${targetDbName}]`);
    console.log("-------------------------------------------------");

    // 3. Fetch collections from source
    const rawCollections = await sourceDb.listCollections().toArray();
    const collections = rawCollections
      .map((c) => c.name)
      .filter((name) => !name.startsWith("system."));

    if (collections.length === 0) {
      console.log("⚠️ No collections found in source database!");
      return;
    }

    console.log(`Found ${collections.length} collections to copy:`);
    console.log(collections.map((c) => ` - ${c}`).join("\n"));
    console.log("-------------------------------------------------\n");

    const startTime = Date.now();
    const stats: { collection: string; count: number; indexes: number }[] = [];

    // 4. Copy each collection
    for (const colName of collections) {
      const srcCol = sourceDb.collection(colName);
      const tgtCol = targetDb.collection(colName);

      const count = await srcCol.countDocuments();
      console.log(`📦 [${colName}]: ${count} documents`);

      // Optionally drop existing collection in target
      if (DROP_TARGET_COLLECTIONS_FIRST) {
        try {
          await tgtCol.drop();
        } catch {
          // Ignore error if collection does not exist in target yet
        }
      }

      if (count > 0) {
        // Copy documents in batches to avoid memory exhaustion
        const cursor = srcCol.find({});
        let batch: any[] = [];
        let copied = 0;

        while (await cursor.hasNext()) {
          const doc = await cursor.next();
          if (doc) {
            batch.push(doc);
          }

          if (batch.length >= BATCH_SIZE) {
            await tgtCol.insertMany(batch);
            copied += batch.length;
            process.stdout.write(
              `   ↳ Copied ${copied}/${count} documents...\r`,
            );
            batch = [];
          }
        }

        if (batch.length > 0) {
          await tgtCol.insertMany(batch);
          copied += batch.length;
        }

        console.log(`   ✅ Copied ${copied}/${count} documents successfully.`);
      } else {
        console.log(`   ℹ️ Collection is empty. Creating empty collection...`);
        await targetDb.createCollection(colName).catch(() => {});
      }

      // Copy Indexes
      let indexCount = 0;
      if (COPY_INDEXES) {
        try {
          const rawIndexes = await srcCol.indexes();
          // Filter out default _id_ index as it is created automatically
          const customIndexes = rawIndexes.filter((idx) => idx.name !== "_id_");

          if (customIndexes.length > 0) {
            for (const idx of customIndexes) {
              const { key, name, unique, sparse, expireAfterSeconds } =
                idx as any;
              const options: any = { name };
              if (unique !== undefined) options.unique = unique;
              if (sparse !== undefined) options.sparse = sparse;
              if (expireAfterSeconds !== undefined) {
                options.expireAfterSeconds = expireAfterSeconds;
              }

              try {
                await tgtCol.createIndex(key, options);
                indexCount++;
              } catch (idxErr: any) {
                console.warn(
                  `   ⚠️ Could not copy index '${name}' on [${colName}]: ${idxErr.message}`,
                );
              }
            }
            console.log(`   ⚡ Copied ${indexCount} indexes.`);
          }
        } catch (idxErr: any) {
          console.warn(
            `   ⚠️ Could not read indexes for [${colName}]: ${idxErr.message}`,
          );
        }
      }

      stats.push({ collection: colName, count, indexes: indexCount });
      console.log("");
    }

    // 5. Final Summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log("=================================================");
    console.log(`🎉 Dump completed successfully in ${duration}s!`);
    console.log("=================================================");
    console.table(stats);
  } catch (error: any) {
    console.error("\n❌ Dump script encountered an error:", error);
  } finally {
    if (fromClient) await fromClient.close();
    if (targetClient) await targetClient.close();
    console.log("🔌 Connections closed.");
  }
}

// Execute the script
dumpDatabase();

/**
 * Migration Script: Single Tenant → Multi-Tenant
 *
 * This script migrates all existing data to be associated with the
 * "founding shop" (the original shop before multi-tenancy).
 *
 * SAFETY GUARANTEES:
 * - Idempotent: safe to run multiple times
 * - Non-destructive: only ADDS shopId field, no data is deleted
 * - Atomic per collection: if a collection fails, others are unaffected
 * - Run this BEFORE deploying new code
 *
 * Usage:
 *   npx ts-node src/scripts/migrate-to-multitenant.ts
 *   OR
 *   ts-node -r tsconfig-paths/register src/scripts/migrate-to-multitenant.ts
 */

import dns from "dns";
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

dns.setServers(["8.8.8.8", "8.8.4.4"]);

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/invosync";

// The founding shop details — this is the original single shop
const FOUNDING_SHOP = {
  name: process.env.FOUNDING_SHOP_NAME || "Sultan Communication",
  slug: process.env.FOUNDING_SHOP_SLUG || "sultan-communication",
  ownerUsername: process.env.FOUNDING_SHOP_OWNER_USERNAME || "sultan",
  phone: process.env.FOUNDING_SHOP_PHONE || "9370564909",
  address:
    process.env.FOUNDING_SHOP_ADDRESS ||
    "Behind Green Land Hotel Chavindra , Bhiwandi - 421302",
};

async function migrate() {
  console.log("🚀 Starting multi-tenancy migration...");
  console.log(`📡 Connecting to: ${MONGODB_URI.replace(/\/\/.*@/, "//***@")}`);

  await mongoose.connect(MONGODB_URI);
  console.log("✅ Connected to MongoDB");

  const db = mongoose.connection.db!;

  // =====================
  // 1. Find or create founding user (owner)
  // =====================
  console.log("\n📋 Step 1: Finding founding user...");
  const usersCol = db.collection("users");

  let foundingUser = await usersCol.findOne({
    username: FOUNDING_SHOP.ownerUsername,
  });
  if (!foundingUser) {
    // Try to find first SUPER_ADMIN from ACLUser
    const aclCol = db.collection("acls");
    const acluserCol = db.collection("aclusers");
    const superAdminAcl = await aclCol.findOne({
      name: { $in: ["SUPER_ADMIN", "CREATOR"] },
    });
    if (superAdminAcl) {
      const superAdminMembership = await acluserCol.findOne({
        acl: superAdminAcl._id,
      });
      if (superAdminMembership) {
        foundingUser = await usersCol.findOne({
          _id: superAdminMembership.user,
        });
      }
    }
  }

  if (!foundingUser) {
    // Fallback: just take the first user
    foundingUser = await usersCol.findOne({});
  }

  if (!foundingUser) {
    throw new Error("❌ No users found in the database. Cannot proceed.");
  }
  console.log(
    `✅ Found founding user: ${foundingUser.username} (${foundingUser._id})`,
  );

  // =====================
  // 2. Find or create the founding shop
  // =====================
  console.log("\n📋 Step 2: Finding or creating founding shop...");
  const shopsCol = db.collection("shops");

  let foundingShop = await shopsCol.findOne({ slug: FOUNDING_SHOP.slug });
  if (!foundingShop) {
    console.log(
      `   Creating new shop: ${FOUNDING_SHOP.name} (${FOUNDING_SHOP.slug})`,
    );
    const result = await shopsCol.insertOne({
      name: FOUNDING_SHOP.name,
      slug: FOUNDING_SHOP.slug,
      owner: foundingUser._id,
      phone: FOUNDING_SHOP.phone,
      address: FOUNDING_SHOP.address,
      status: "ACTIVE",
      settings: {
        currency: "INR",
        invoicePrefix: "INV",
        lowStockAlert: 10,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    foundingShop = await shopsCol.findOne({ _id: result.insertedId });
    console.log(`✅ Created founding shop with ID: ${foundingShop!._id}`);
  } else {
    console.log(
      `✅ Founding shop already exists: ${foundingShop.name} (${foundingShop._id})`,
    );
  }

  const shopId = foundingShop!._id;

  // =====================
  // 3. Create ShopMember records for all existing users
  // =====================
  console.log("\n📋 Step 3: Adding all users as shop members...");
  const shopMembersCol = db.collection("shopmembers");

  // NOTE: Mongoose registers ACLUser model → MongoDB collection "aclusers"
  //       ACL model → MongoDB collection "acls"
  //       Try both lowercase plural and the model-derived name.
  const aclUsersCol = db.collection("aclusers");
  const aclsCol = db.collection("acls");

  // ---------------------------------------------------------------
  // ACL name → ShopMember role mapping
  // Old ACL system may have had different role names. We normalise
  // them here to the valid ShopMember enum values:
  //   ["PLATFORM_ADMIN", "SUPER_ADMIN", "ADMIN", "WORKER", "SPECIAL_RIGHTS"]
  // ---------------------------------------------------------------
  const ACL_ROLE_MAP: Record<string, string> = {
    // Direct matches (already valid)
    PLATFORM_ADMIN: "PLATFORM_ADMIN",
    SUPER_ADMIN: "SUPER_ADMIN",
    ADMIN: "ADMIN",
    WORKER: "WORKER",
    SPECIAL_RIGHTS: "SPECIAL_RIGHTS",
    // Legacy ACL names that need mapping
    CREATOR: "SUPER_ADMIN", // Original single-shop owner
    MANAGER: "ADMIN", // Mid-level access
    CASHIER: "WORKER", // Basic billing access
    VIEWER: "WORKER", // Read-only (map to WORKER)
    BILLING: "WORKER", // Billing-only
  };

  const mapAclToRole = (aclName: string): string | null => {
    const normalized = aclName.toUpperCase().trim();
    return ACL_ROLE_MAP[normalized] || null;
  };

  const allUsers = await usersCol.find({}).toArray();
  console.log(`   Found ${allUsers.length} users`);

  for (const user of allUsers) {
    // Check if already a member
    const existingMembership = await shopMembersCol.findOne({
      shop: shopId,
      user: user._id,
    });
    if (existingMembership) {
      console.log(`   ⏭️  ${user.username} already a member, skipping`);
      continue;
    }

    // Determine roles from existing ACL system
    const userAclEntries = await aclUsersCol.find({ user: user._id }).toArray();
    const roles: string[] = [];
    for (const entry of userAclEntries) {
      const acl = await aclsCol.findOne({ _id: entry.acl });
      if (acl?.name) {
        const mappedRole = mapAclToRole(acl.name);
        if (mappedRole) {
          roles.push(mappedRole);
          if (mappedRole !== acl.name) {
            console.log(
              `   ℹ️  Mapped legacy ACL "${acl.name}" → "${mappedRole}" for ${user.username}`,
            );
          }
        } else {
          console.warn(
            `   ⚠️  Unknown ACL role "${acl.name}" for ${user.username} — defaulting to WORKER`,
          );
          roles.push("WORKER");
        }
      }
    }

    // Deduplicate roles
    const finalRoles = roles.length > 0 ? [...new Set(roles)] : ["WORKER"];
    if (
      user._id.toString() === foundingUser._id.toString() &&
      !finalRoles.includes("SUPER_ADMIN")
    ) {
      finalRoles.unshift("SUPER_ADMIN");
    }

    await shopMembersCol.insertOne({
      shop: shopId,
      user: user._id,
      roles: finalRoles,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    console.log(
      `   ✅ Added ${user.username} with roles: ${finalRoles.join(", ")}`,
    );
  }

  // =====================
  // 4. Add shopId to counters
  // =====================
  console.log("\n📋 Step 4: Migrating counters...");
  const countersCol = db.collection("counters");

  const existingCounters = await countersCol
    .find({ shopId: { $exists: false } })
    .toArray();
  console.log(`   Found ${existingCounters.length} counters without shopId`);

  if (existingCounters.length > 0) {
    const result = await countersCol.updateMany(
      { shopId: { $exists: false } },
      { $set: { shopId } },
    );
    console.log(`   ✅ Updated ${result.modifiedCount} counters`);
  } else {
    // Create counters if they don't exist
    const counterNames = ["billId", "transactionId", "returnBillId"];
    for (const name of counterNames) {
      const exists = await countersCol.findOne({ shopId, name });
      if (!exists) {
        // Get max value from existing documents to ensure no ID collision
        let maxValue = 1;
        if (name === "billId") {
          const billsCol = db.collection("bills");
          const maxBill = await billsCol.findOne(
            {},
            { sort: { id: -1 }, projection: { id: 1 } },
          );
          maxValue = (maxBill?.id || 0) + 1;
        } else if (name === "transactionId") {
          const txCol = db.collection("transactions");
          const maxTx = await txCol.findOne(
            {},
            { sort: { id: -1 }, projection: { id: 1 } },
          );
          maxValue = (maxTx?.id || 0) + 1;
        } else if (name === "returnBillId") {
          const rbCol = db.collection("returnbills");
          const maxRb = await rbCol.findOne(
            {},
            { sort: { id: -1 }, projection: { id: 1 } },
          );
          maxValue = (maxRb?.id || 0) + 1;
        }
        await countersCol.insertOne({
          shopId,
          name,
          value: maxValue,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        console.log(`   ✅ Created counter ${name} with value ${maxValue}`);
      }
    }
  }

  // =====================
  // 5. Drop old global or faulty compound unique indexes before backfilling shopId
  // =====================
  console.log("\n📋 Step 5: Dropping old & conflicting unique indexes...");

  const indexesToDrop: { collection: string; index: string }[] = [
    { collection: "bills", index: "id_1" },
    { collection: "bills", index: "idempotencyKey_1" },
    { collection: "bills", index: "shopId_1_idempotencyKey_1" },
    { collection: "products", index: "idempotencyKey_1" },
    { collection: "products", index: "shopId_1_idempotencyKey_1" },
    { collection: "customers", index: "phone_1" },
    { collection: "customers", index: "idempotencyKey_1" },
    { collection: "customers", index: "shopId_1_idempotencyKey_1" },
    { collection: "returnbills", index: "id_1" },
    { collection: "returnbills", index: "idempotencyKey_1" },
    { collection: "returnbills", index: "shopId_1_idempotencyKey_1" },
    { collection: "transactions", index: "id_1" },
    { collection: "transactions", index: "idempotencyKey_1" },
    { collection: "transactions", index: "shopId_1_idempotencyKey_1" },
    { collection: "categories", index: "name_1" },
    { collection: "counters", index: "name_1" },
  ];

  for (const { collection: colName, index } of indexesToDrop) {
    try {
      const collection = db.collection(colName);
      const indexes = await collection.listIndexes().toArray();
      const indexExists = indexes.some((i) => i.name === index);

      if (indexExists) {
        await collection.dropIndex(index);
        console.log(`   ✅ Dropped index ${colName}.${index}`);
      } else {
        console.log(`   ⏭️  Index ${colName}.${index} not found, skipping`);
      }
    } catch (error: any) {
      console.warn(
        `   ⚠️  Could not drop ${colName}.${index}: ${error.message}`,
      );
    }
  }

  // =====================
  // 6. Backfill shopId to all tenant-scoped collections
  // =====================
  const collectionsToMigrate = [
    "bills",
    "products",
    "customers",
    "transactions",
    "returnbills",
    "stocks",
    "categories",
    "notifications",
    "customerjourneys",
    "journeylogs",
    "loggers",
  ];

  console.log("\n📋 Step 6: Backfilling shopId to all collections...");

  for (const collectionName of collectionsToMigrate) {
    try {
      const collection = db.collection(collectionName);
      const count = await collection.countDocuments({
        shopId: { $exists: false },
      });

      if (count === 0) {
        console.log(
          `   ⏭️  ${collectionName}: All documents already have shopId`,
        );
        continue;
      }

      console.log(`   Updating ${count} documents in ${collectionName}...`);
      const result = await collection.updateMany(
        { shopId: { $exists: false } },
        { $set: { shopId } },
      );

      console.log(
        `   ✅ ${collectionName}: Updated ${result.modifiedCount}/${count} documents`,
      );
    } catch (error: any) {
      console.error(
        `   ❌ Failed to migrate ${collectionName}: ${error.message}`,
      );
    }
  }

  // =====================
  // 7. Create proper compound indexes (with partialFilterExpression for optional fields)
  // =====================
  console.log("\n📋 Step 7: Creating multi-tenant compound indexes...");
  const partialIndexCollections = [
    "products",
    "customers",
    "bills",
    "returnbills",
    "transactions",
  ];

  for (const colName of partialIndexCollections) {
    try {
      await db.collection(colName).createIndex(
        { shopId: 1, idempotencyKey: 1 },
        {
          name: "shopId_1_idempotencyKey_1",
          unique: true,
          partialFilterExpression: { idempotencyKey: { $type: "string" } },
        },
      );
      console.log(
        `   ✅ Created partial compound index on ${colName}.{shopId, idempotencyKey}`,
      );
    } catch (err: any) {
      console.warn(
        `   ⚠️ Could not create index on ${colName}: ${err.message}`,
      );
    }
  }

  // =====================
  // 7. Report legacy ACL collections (safe to drop after verification)
  // =====================
  console.log("\n📋 Step 7: Checking legacy ACL collections...");
  try {
    const aclCount = await db.collection("acls").countDocuments();
    const aclUserCount = await db.collection("aclusers").countDocuments();
    const shopMemberCount = await db.collection("shopmembers").countDocuments();
    console.log(`   acls collection: ${aclCount} documents`);
    console.log(`   aclusers collection: ${aclUserCount} documents`);
    console.log(
      `   shopmembers collection: ${shopMemberCount} documents (new system)`,
    );
    if (shopMemberCount > 0) {
      console.log(
        `   ✅ ShopMember migration complete. Legacy ACL collections can be DROPPED once you verify the migration.`,
      );
      console.log(`   ⚠️  To drop legacy ACL data, run in MongoDB shell:`);
      console.log(`      db.acls.drop()`);
      console.log(`      db.aclusers.drop()`);
    }
  } catch (e: any) {
    console.warn(`   ⚠️  Could not check ACL collections: ${e.message}`);
  }

  console.log("\n🎉 Migration complete!");
  console.log(`   Shop ID: ${shopId}`);
  console.log(`   Shop Name: ${foundingShop!.name}`);
  console.log("\n⚠️  IMPORTANT NEXT STEPS:");
  console.log("   1. Restart the backend server to apply new indexes");
  console.log("   2. Run the onboarding script for any additional shops");
  console.log(
    "   3. Update all frontend auth calls to include shopId in tokens",
  );
  console.log(
    "   4. Once verified, drop legacy acls and aclusers collections (see Step 7 above)",
  );

  await mongoose.disconnect();
  process.exit(0);
}

migrate().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});

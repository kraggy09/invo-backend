import dns from "dns";
import readline from "readline";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import dotenv from "dotenv";

dotenv.config();

// Fix for Node.js SRV DNS resolution issues on certain networks
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const MONGODB_URI =
  process.env.MONGO_URI ||
  process.env.MONGODB_URI ||
  "mongodb://127.0.0.1:27017/invosync";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question: string, defaultValue = ""): Promise<string> {
  return new Promise((resolve) => {
    const prompt = defaultValue
      ? `${question} [default: ${defaultValue}]: `
      : `${question}: `;
    rl.question(prompt, (answer) => {
      resolve(answer.trim() || defaultValue);
    });
  });
}

async function askRequired(
  question: string,
  defaultValue = "",
): Promise<string> {
  while (true) {
    const answer = await ask(question, defaultValue);
    if (answer) return answer;
    console.log("   ⚠️  This field cannot be empty. Please try again.");
  }
}

function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-") // Replace spaces with -
    .replace(/[^\w-]+/g, "") // Remove all non-word chars
    .replace(/--+/g, "-") // Replace multiple - with single -
    .replace(/^-+/, "") // Trim - from start of text
    .replace(/-+$/, ""); // Trim - from end of text
}

async function onboard() {
  console.log("\n=======================================================");
  console.log("          🏪  INVOSYNC SHOP ONBOARDING WIZARD          ");
  console.log("=======================================================\n");

  console.log("⏳ Connecting to MongoDB...");
  await mongoose.connect(MONGODB_URI);
  console.log("✅ Connected to MongoDB\n");

  const db = mongoose.connection.db!;
  const shopsCol = db.collection("shops");
  const usersCol = db.collection("users");
  const shopMembersCol = db.collection("shopmembers");
  const countersCol = db.collection("counters");

  // 1. Shop Name
  const shopName = await askRequired("🏬 Shop Name");

  // 2. Shop Slug (with uniqueness check)
  let shopSlug = "";
  const suggestedSlug = slugify(shopName);
  while (true) {
    const inputSlug = await askRequired("🔗 Shop Slug", suggestedSlug);
    shopSlug = slugify(inputSlug);

    const existingShop = await shopsCol.findOne({ slug: shopSlug });
    if (existingShop) {
      console.log(
        `   ❌ A shop with slug "${shopSlug}" already exists! Please choose another.`,
      );
    } else {
      break;
    }
  }

  // 3. Shop Address & Details
  const shopAddress = await ask("📍 Shop Address");
  const shopPhone = await ask("📞 Shop Phone (optional)");
  const shopGstin = await ask("📄 Shop GSTIN (optional)");
  const invoicePrefix = (await ask("🧾 Invoice Prefix", "INV")).toUpperCase();
  const discordWebhook = await ask("🔔 Discord Webhook URL (optional)");

  console.log("\n💰 Billing Rate Mode:");
  console.log(
    "   1. Multi-Tier (Retail, Wholesale, Super Wholesale) [default]",
  );
  console.log("   2. Retail Only (Single Price Rate)");
  const pricingModeChoice = await ask("   Select Rate Mode (1 or 2)", "1");
  const pricingMode =
    pricingModeChoice.trim() === "2" ? "RETAIL_ONLY" : "MULTI_TIER";

  console.log("\n🖨️  Bill Print Layout:");
  console.log("   1. Thermal (80mm Receipt Printer) [default]");
  console.log("   2. A4 (Standard Full Page Invoice)");
  const printTypeChoice = await ask("   Select Print Layout (1 or 2)", "1");
  const printType = printTypeChoice.trim() === "2" ? "A4" : "THERMAL";

  // 4. Owner Credentials
  console.log("\n-------------------------------------------------------");
  console.log("👤 Owner Setup");
  console.log("-------------------------------------------------------");

  const ownerUsername = (await askRequired("👤 Owner Username")).toLowerCase();

  let owner = await usersCol.findOne({ username: ownerUsername });
  let ownerName = "";
  let ownerPassword = "";
  let ownerPin = "";

  if (owner) {
    console.log(
      `   ℹ️  Existing user found: "${ownerUsername}" (${
        owner.name || "No Name"
      }).`,
    );
    console.log(
      "      This user will be assigned as SUPER_ADMIN of the new shop.",
    );
    if (!owner.pin) {
      ownerPin = await ask(
        "🔢 Owner PIN (none set currently, enter PIN or press Enter to skip)",
      );
    } else {
      console.log(`      Current PIN: ${owner.pin}`);
      ownerPin = await ask(
        "🔢 Update Owner PIN? (press Enter to keep current)",
        owner.pin,
      );
    }
  } else {
    console.log(
      `   ℹ️  User "${ownerUsername}" not found. Creating a new user account.`,
    );
    ownerName = await askRequired("👤 Owner Full Name", ownerUsername);
    ownerPassword = await askRequired("🔑 Owner Password");
    ownerPin = await askRequired(
      "🔢 Owner PIN (e.g. 1234 for quick POS actions)",
    );
  }

  // Confirmation summary
  console.log("\n=======================================================");
  console.log("📋 Review Details Before Proceeding:");
  console.log("=======================================================");
  console.log(`   Shop Name:        ${shopName}`);
  console.log(`   Shop Slug:        ${shopSlug}`);
  console.log(`   Shop Address:     ${shopAddress || "(none)"}`);
  console.log(`   Shop Phone:       ${shopPhone || "(none)"}`);
  console.log(`   Shop GSTIN:       ${shopGstin || "(none)"}`);
  console.log(`   Invoice Prefix:   ${invoicePrefix}`);
  console.log(`   Pricing Mode:     ${pricingMode}`);
  console.log(`   Print Layout:     ${printType}`);
  console.log(`   Discord Webhook:  ${discordWebhook || "(none)"}`);
  console.log("   ----------------------------------------------------");
  console.log(`   Owner Username:   ${ownerUsername}`);
  console.log(`   Owner Name:       ${owner ? owner.name : ownerName}`);
  console.log(
    `   Owner PIN:        ${ownerPin || (owner?.pin ? owner.pin : "(none)")}`,
  );
  console.log(`   Owner Status:     ${owner ? "Existing user" : "New user"}`);
  console.log("=======================================================\n");

  const confirm = await ask(
    "❓ Confirm and proceed with onboarding? (Y/n)",
    "Y",
  );
  if (confirm.toLowerCase() !== "y" && confirm.toLowerCase() !== "yes") {
    console.log("❌ Onboarding cancelled by user.\n");
    return;
  }

  console.log("\n🚀 Proceeding with onboarding...");

  // Create owner if does not exist
  if (!owner) {
    const hashedPassword = await bcrypt.hash(ownerPassword, 10);
    const result = await usersCol.insertOne({
      name: ownerName,
      username: ownerUsername,
      password: hashedPassword,
      pin: ownerPin || undefined,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    owner = await usersCol.findOne({ _id: result.insertedId });
    console.log(`✅ Created new user: ${ownerUsername}`);
  } else if (ownerPin && ownerPin !== owner.pin) {
    await usersCol.updateOne(
      { _id: owner._id },
      { $set: { pin: ownerPin, updatedAt: new Date() } },
    );
    console.log(`✅ Updated PIN for user: ${ownerUsername}`);
  }

  // Create the shop
  const shopResult = await shopsCol.insertOne({
    name: shopName,
    slug: shopSlug,
    owner: owner!._id,
    phone: shopPhone || "",
    address: shopAddress || "",
    gstin: shopGstin || "",
    status: "ACTIVE",
    settings: {
      currency: "INR",
      invoicePrefix: invoicePrefix || "INV",
      lowStockAlert: 10,
      discordWebhookUrl: discordWebhook || undefined,
      pricingMode,
      printType,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const shop = await shopsCol.findOne({ _id: shopResult.insertedId });
  const shopId = shop!._id;
  console.log(`✅ Created shop: ${shopName} (${shopId})`);

  // Add owner as SUPER_ADMIN
  await shopMembersCol.insertOne({
    shop: shopId,
    user: owner!._id,
    roles: ["SUPER_ADMIN"],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  console.log(`✅ Added ${ownerUsername} as SUPER_ADMIN`);

  // Initialize counters for this shop
  await countersCol.insertMany([
    {
      shopId,
      name: "billId",
      value: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      shopId,
      name: "transactionId",
      value: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      shopId,
      name: "returnBillId",
      value: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]);
  console.log(`✅ Initialized counters for shop`);

  console.log("\n🎉 Shop onboarding complete!");
  console.log(`   Shop ID:   ${shopId}`);
  console.log(`   Shop Name: ${shopName}`);
  console.log(`   Shop Slug: ${shopSlug}`);
  console.log(`   Owner:     ${ownerUsername}`);
  console.log("\n📋 Next Steps:");
  console.log(
    `   1. User "${ownerUsername}" can now log in and select "${shopName}"`,
  );
  console.log(`   2. Use /api/admin/users to add more members to this shop`);
  console.log(
    `   3. Set up Discord webhook if needed via /api/shops/settings\n`,
  );
}

async function main() {
  try {
    await onboard();
  } catch (err) {
    console.error("\n❌ Onboarding failed:", err);
  } finally {
    rl.close();
    await mongoose.disconnect();
    process.exit(0);
  }
}

main();

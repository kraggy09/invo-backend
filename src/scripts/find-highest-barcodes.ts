import dns from "dns";
import dotenv from "dotenv";
import mongoose from "mongoose";
import Product from "../models/product.model";
import Shop from "../models/shop.model";

// Resolve SRV records reliably if connected to MongoDB Atlas
try {
  dns.setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1"]);
} catch (e) {
  // Ignore DNS server error if not permitted
}

dotenv.config();

const DIGIT_RANGES = [
  { label: "2-Digit", digits: 2, min: 10, max: 99 },
  { label: "3-Digit", digits: 3, min: 100, max: 999 },
  { label: "4-Digit", digits: 4, min: 1000, max: 9999 },
  { label: "5-Digit", digits: 5, min: 10000, max: 99999 },
];

const args = process.argv.slice(2);
const getArgVal = (name: string): string | null => {
  const match = args.find((a) => a.startsWith(`--${name}=`));
  if (match) return match.split("=")[1];
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith("--")) {
    return args[idx + 1];
  }
  return null;
};

const filterShopId = getArgVal("shopId");
const filterShopName = getArgVal("shopName");
const topCount = parseInt(getArgVal("top") || "3", 10);
const customUri = getArgVal("uri") || process.env.MONGO_URI || process.env.MONGODB_URI;

async function findHighestBarcodes() {
  if (!customUri) {
    console.error("❌ Error: MONGO_URI is not defined in .env or via --uri argument.");
    process.exit(1);
  }

  console.log("\n========================================================");
  console.log("   BARCODE SEARCH TOOL: 2, 3, 4, AND 5 DIGIT RANGES");
  console.log("========================================================\n");

  console.log("Connecting to MongoDB...");
  await mongoose.connect(customUri);
  console.log("Connected successfully to database.\n");

  const shops = await Shop.find({}).lean();
  const shopMap = new Map<string, any>();
  for (const shop of shops) {
    shopMap.set(String(shop._id), shop);
  }

  let targetShopIds: mongoose.Types.ObjectId[] | null = null;
  if (filterShopId) {
    targetShopIds = [new mongoose.Types.ObjectId(filterShopId)];
  } else if (filterShopName) {
    const matched = shops.filter(
      (s) => s.name && s.name.toLowerCase().includes(filterShopName.toLowerCase())
    );
    if (matched.length === 0) {
      console.warn(`No shop found matching name "${filterShopName}".`);
    } else {
      targetShopIds = matched.map((s) => s._id as mongoose.Types.ObjectId);
    }
  }

  const facetStages: Record<string, any[]> = {};
  for (const range of DIGIT_RANGES) {
    const key = `digits_${range.digits}`;
    facetStages[key] = [
      { $match: { numBarcode: { $gte: range.min, $lte: range.max } } },
      { $sort: { numBarcode: -1 } },
      { $limit: topCount },
    ];
  }

  const baseMatch: Record<string, any> = {};
  if (targetShopIds) {
    baseMatch.shopId = { $in: targetShopIds };
  }

  const pipeline = [
    { $match: baseMatch },
    {
      $project: {
        shopId: 1,
        name: 1,
        category: 1,
        mrp: 1,
        retailPrice: 1,
        stock: 1,
        barcodes: {
          $cond: {
            if: { $isArray: "$barcode" },
            then: "$barcode",
            else: {
              $cond: {
                if: { $ne: ["$barcode", null] },
                then: ["$barcode"],
                else: [],
              },
            },
          },
        },
      },
    },
    { $unwind: "$barcodes" },
    {
      $addFields: {
        numBarcode: {
          $convert: {
            input: "$barcodes",
            to: "long",
            onError: null,
            onNull: null,
          },
        },
      },
    },
    { $match: { numBarcode: { $ne: null } } },
    { $facet: facetStages },
  ];

  console.log("Analyzing product barcode catalog...");
  const [results] = await Product.aggregate(pipeline);

  console.log("\n========================================================");
  console.log("                GLOBAL HIGHEST BARCODES");
  console.log("========================================================");

  const summaryTable = [];

  for (const range of DIGIT_RANGES) {
    const key = `digits_${range.digits}`;
    const items = results[key] || [];

    if (items.length === 0) {
      summaryTable.push({
        Range: `${range.digits} Digit (${range.min} - ${range.max})`,
        "Highest Barcode": "None found",
        "Next Available": range.min,
        Product: "N/A",
        Shop: "N/A",
      });
      continue;
    }

    const highest = items[0];
    const shop = shopMap.get(String(highest.shopId));
    const shopName = shop ? shop.name : String(highest.shopId);
    const nextBarcode = highest.numBarcode < range.max ? highest.numBarcode + 1 : "Exhausted";

    summaryTable.push({
      Range: `${range.digits} Digit (${range.min} - ${range.max})`,
      "Highest Barcode": highest.numBarcode,
      "Next Available": nextBarcode,
      Product: `${highest.name} (ID: ${highest._id})`,
      Shop: `${shopName}`,
    });
  }

  console.table(summaryTable);

  console.log("\n--------------------------------------------------------");
  console.log("             DETAILED BREAKDOWN BY DIGIT");
  console.log("--------------------------------------------------------");

  for (const range of DIGIT_RANGES) {
    const key = `digits_${range.digits}`;
    const items = results[key] || [];

    console.log(`\n📌 ${range.label} Range [${range.min} - ${range.max}]:`);
    if (items.length === 0) {
      console.log(`   (No products found with a ${range.digits}-digit barcode)`);
      continue;
    }

    items.forEach((item: any, index: number) => {
      const shop = shopMap.get(String(item.shopId));
      const shopDisplay = shop ? `${shop.name} (${shop._id})` : String(item.shopId);
      const isTop = index === 0;
      const marker = isTop ? "👑 HIGHEST" : `   #${index + 1}    `;

      console.log(
        `   ${marker} Barcode: ${item.numBarcode} | Product: "${item.name}" | Shop: ${shopDisplay} | Category: ${item.category || "N/A"} | Price: ₹${item.retailPrice ?? "N/A"}`
      );
    });
  }

  console.log("\n========================================================");
  console.log("          SHOP SETTINGS (currentBarcode counters)");
  console.log("========================================================");

  const shopSettingsTable = shops
    .filter((s) => !targetShopIds || targetShopIds.some((id) => id.equals(s._id as any)))
    .map((s) => ({
      "Shop Name": s.name || "Unnamed",
      "Shop ID": String(s._id),
      "currentBarcode Setting": s.settings?.currentBarcode ?? "Not set",
      "Pricing Mode": s.settings?.pricingMode ?? "N/A",
      "Print Type": s.settings?.printType ?? "N/A",
    }));

  if (shopSettingsTable.length > 0) {
    console.table(shopSettingsTable);
  } else {
    console.log("No shops found.");
  }

  if (shops.length > 1 && !filterShopId) {
    console.log("\n========================================================");
    console.log("              HIGHEST BARCODES PER SHOP");
    console.log("========================================================");

    for (const shop of shops) {
      const shopIdStr = String(shop._id);
      console.log(`\n🏪 Shop: "${shop.name}" (ID: ${shopIdStr})`);
      console.log(`   Settings currentBarcode: ${shop.settings?.currentBarcode ?? "Not set"}`);

      const perShopRows = [];
      for (const range of DIGIT_RANGES) {
        const key = `digits_${range.digits}`;
        const shopItems = (results[key] || []).filter((i: any) => String(i.shopId) === shopIdStr);

        if (shopItems.length > 0) {
          const top = shopItems[0];
          perShopRows.push({
            Range: `${range.digits}-digit`,
            "Highest Barcode": top.numBarcode,
            "Next Barcode": top.numBarcode < range.max ? top.numBarcode + 1 : "Exhausted",
            Product: top.name,
          });
        } else {
          perShopRows.push({
            Range: `${range.digits}-digit`,
            "Highest Barcode": "None",
            "Next Barcode": range.min,
            Product: "-",
          });
        }
      }
      console.table(perShopRows);
    }
  }

  console.log("\nDone! To query a specific shop, run:");
  console.log("  npm run barcodes:highest -- --shopId=<shopId>");
  console.log("  npm run barcodes:highest -- --shopName=\"<shopName>\"");
}

findHighestBarcodes()
  .then(async () => {
    await mongoose.disconnect();
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n❌ Execution Error:", err);
    process.exit(1);
  });


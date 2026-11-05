/**
 * Category Sales & Profit Calculator Script
 * 
 * Usage:
 *   node src/scripts/calculate-category-sales.js <category> <date> [options]
 *   node src/scripts/calculate-category-sales.js <category> <startDate> <endDate> [options]
 * 
 * Examples:
 *   # Single Day:
 *   node src/scripts/calculate-category-sales.js "cold drink" "2026-10-13"
 *   npm run sales:category -- "cold drink" "2026-10-13"
 * 
 *   # Date Range:
 *   node src/scripts/calculate-category-sales.js "cold drink" "2026-10-01" "2026-10-13"
 *   npm run sales:category -- "cigarette" "2026-10-10" "2026-10-13"
 * 
 *   # Using Flags:
 *   node src/scripts/calculate-category-sales.js --category="biscuits" --start="2026-10-10" --end="2026-10-13"
 *   node src/scripts/calculate-category-sales.js "soap" "2026-10-13" --json
 */

const dns = require("dns");
const path = require("path");
const mongoose = require("mongoose");
const moment = require("moment-timezone");

// Ensure DNS resolution for MongoDB Atlas SRV connection strings
dns.setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1"]);

// Load environment variables from .env
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
require("dotenv").config();

const IST = "Asia/Kolkata";

const SUPPORTED_DATE_FORMATS = [
  "YYYY-MM-DD",
  "DD-MM-YYYY",
  "DD/MM/YYYY",
  "YYYY/MM/DD",
  "MM/DD/YYYY",
  "D-M-YYYY",
  "D/M/YYYY",
  moment.ISO_8601,
];

/**
 * Helper to parse a single date string into a moment object in IST
 */
function parseMomentDate(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return null;

  const normalized = dateStr.trim().toLowerCase();
  if (normalized === "today") {
    return moment.tz(IST);
  }
  if (normalized === "yesterday") {
    return moment.tz(IST).subtract(1, "days");
  }

  let mDate = moment.tz(dateStr.trim(), SUPPORTED_DATE_FORMATS, true, IST);
  if (!mDate.isValid()) {
    // Fallback loose parsing
    mDate = moment.tz(dateStr.trim(), IST);
  }

  return mDate.isValid() ? mDate : null;
}

/**
 * Parse CLI arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    category: null,
    startDate: null,
    endDate: null,
    shop: null,
    json: false,
    help: false,
  };

  const positional = [];

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg.startsWith("--category=")) {
      options.category = arg.split("=")[1].replace(/^["']|["']$/g, "").trim();
    } else if (arg.startsWith("--date=")) {
      const d = arg.split("=")[1].replace(/^["']|["']$/g, "").trim();
      options.startDate = d;
      options.endDate = d;
    } else if (arg.startsWith("--startDate=") || arg.startsWith("--start=")) {
      options.startDate = arg.split("=")[1].replace(/^["']|["']$/g, "").trim();
    } else if (arg.startsWith("--endDate=") || arg.startsWith("--end=")) {
      options.endDate = arg.split("=")[1].replace(/^["']|["']$/g, "").trim();
    } else if (arg.startsWith("--shop=")) {
      options.shop = arg.split("=")[1].replace(/^["']|["']$/g, "").trim();
    } else if (arg.startsWith("--")) {
      // Ignore unknown flags
    } else {
      positional.push(arg.replace(/^["']|["']$/g, "").trim());
    }
  }

  // Handle positional arguments:
  // [0] -> Category
  // [1] -> Start Date (or Single Date)
  // [2] -> End Date (if it parses as a date) OR Shop
  // [3] -> Shop
  if (!options.category && positional.length > 0) {
    options.category = positional[0];
  }

  if (positional.length > 1 && !options.startDate) {
    options.startDate = positional[1];
  }

  if (positional.length > 2) {
    if (!options.endDate) {
      const candidateDate = parseMomentDate(positional[2]);
      if (candidateDate) {
        options.endDate = positional[2];
        if (!options.shop && positional.length > 3) {
          options.shop = positional[3];
        }
      } else {
        // Not a date, assume it's shop
        if (!options.shop) {
          options.shop = positional[2];
        }
      }
    } else if (!options.shop) {
      options.shop = positional[2];
    }
  }

  // If only one date provided, endDate matches startDate (single day mode)
  if (options.startDate && !options.endDate) {
    options.endDate = options.startDate;
  }

  return options;
}

/**
 * Parse start and optional end date strings into IST range
 */
function parseDateRange(startDateStr, endDateStr) {
  if (!startDateStr) {
    throw new Error("Date is required.");
  }

  const mStart = parseMomentDate(startDateStr);
  if (!mStart) {
    throw new Error(
      `Invalid start date: "${startDateStr}". Supported formats include YYYY-MM-DD (e.g. 2026-10-13), DD-MM-YYYY, "today", or "yesterday".`
    );
  }

  const effectiveEndStr = endDateStr || startDateStr;
  const mEnd = parseMomentDate(effectiveEndStr);
  if (!mEnd) {
    throw new Error(
      `Invalid end date: "${effectiveEndStr}". Supported formats include YYYY-MM-DD (e.g. 2026-10-13), DD-MM-YYYY, "today", or "yesterday".`
    );
  }

  // If user provided start > end, swap them gracefully
  let [startM, endM] = mStart.isAfter(mEnd) ? [mEnd, mStart] : [mStart, mEnd];

  const startOfDay = startM.clone().startOf("day").toDate();
  const endOfDay = endM.clone().endOf("day").toDate();
  const formattedStartDate = startM.format("YYYY-MM-DD");
  const formattedEndDate = endM.format("YYYY-MM-DD");
  const isRange = formattedStartDate !== formattedEndDate;

  const dateDisplay = isRange
    ? `${formattedStartDate} to ${formattedEndDate}`
    : formattedStartDate;

  return {
    startOfDay,
    endOfDay,
    formattedStartDate,
    formattedEndDate,
    isRange,
    dateDisplay,
  };
}

/**
 * Main calculation function
 */
async function calculateCategorySales(params) {
  const { category, startDate, endDate, date, shopIdOrSlug } = params;

  if (!category) {
    throw new Error("Category name is required.");
  }

  const effectiveStart = startDate || date;
  const effectiveEnd = endDate || effectiveStart;

  const {
    startOfDay,
    endOfDay,
    formattedStartDate,
    formattedEndDate,
    isRange,
    dateDisplay,
  } = parseDateRange(effectiveStart, effectiveEnd);

  const targetCategoryLower = category.trim().toLowerCase();
  const db = mongoose.connection.db;

  // 1. Resolve optional shop filter if specified
  let shopFilter = {};
  if (shopIdOrSlug) {
    if (mongoose.Types.ObjectId.isValid(shopIdOrSlug)) {
      shopFilter = { shopId: new mongoose.Types.ObjectId(shopIdOrSlug) };
    } else {
      const shopDoc = await db.collection("shops").findOne({
        $or: [
          { slug: shopIdOrSlug.toLowerCase() },
          { name: new RegExp(`^${shopIdOrSlug}$`, "i") },
        ],
      });
      if (shopDoc) {
        shopFilter = { shopId: shopDoc._id };
      }
    }
  }

  // 2. Identify products that belong to this category in the products collection
  // (Provides cross-referencing even if productSnapshot has null/missing category)
  const productCategoryRegex = new RegExp(`^${targetCategoryLower}$`, "i");
  const matchingProducts = await db
    .collection("products")
    .find(
      { category: productCategoryRegex },
      { projection: { _id: 1, name: 1, costPrice: 1, category: 1 } }
    )
    .toArray();

  const matchingProductIdSet = new Set(
    matchingProducts.map((p) => p._id.toString())
  );
  const productPriceMap = new Map();
  matchingProducts.forEach((p) => {
    productPriceMap.set(p._id.toString(), p);
  });

  // 3. Query all bills within the date range (matching on either `date` or `createdAt`)
  const billQuery = {
    ...shopFilter,
    $or: [
      { date: { $gte: startOfDay, $lte: endOfDay } },
      { createdAt: { $gte: startOfDay, $lte: endOfDay } },
    ],
  };

  const bills = await db
    .collection("bills")
    .find(billQuery)
    .sort({ id: 1, createdAt: 1 })
    .toArray();

  // 4. Pre-fetch customer names for clean display
  const customerIds = bills
    .map((b) => b.customer)
    .filter((id) => id && mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  const customerMap = new Map();
  if (customerIds.length > 0) {
    const customers = await db
      .collection("customers")
      .find(
        { _id: { $in: customerIds } },
        { projection: { _id: 1, name: 1, phone: 1 } }
      )
      .toArray();
    customers.forEach((c) => {
      customerMap.set(c._id.toString(), c);
    });
  }

  // 5. Calculate category sales, CP, SP, and profit per bill
  const billsSummary = [];
  let grandTotalQuantity = 0;
  let grandTotalCP = 0;
  let grandTotalSP = 0;
  let grandTotalProfit = 0;

  for (const bill of bills) {
    const matchingItems = [];
    let billCategoryQuantity = 0;
    let billCategoryCP = 0;
    let billCategorySP = 0;

    for (const item of bill.items || []) {
      const snapshotCategory = (
        item.productSnapshot?.category || ""
      ).trim().toLowerCase();
      const productIdStr = item.product ? item.product.toString() : null;

      // Check if item belongs to category
      const isMatch =
        snapshotCategory === targetCategoryLower ||
        (productIdStr && matchingProductIdSet.has(productIdStr));

      if (!isMatch) continue;

      const quantity = Number(item.quantity) || 0;
      const sp = Number(item.total) || 0;

      // Determine unit cost price:
      // 1) item.costPrice
      // 2) item.productSnapshot.costPrice
      // 3) product document's costPrice
      // 4) 0
      let unitCP = 0;
      if (item.costPrice != null && !isNaN(Number(item.costPrice))) {
        unitCP = Number(item.costPrice);
      } else if (
        item.productSnapshot?.costPrice != null &&
        !isNaN(Number(item.productSnapshot.costPrice))
      ) {
        unitCP = Number(item.productSnapshot.costPrice);
      } else if (productIdStr && productPriceMap.has(productIdStr)) {
        unitCP = Number(productPriceMap.get(productIdStr).costPrice) || 0;
      }

      const totalCP = unitCP * quantity;
      const itemProfit = sp - totalCP;

      const rawProductName =
        item.productSnapshot?.name ||
        (productIdStr && productPriceMap.get(productIdStr)?.name) ||
        "Unknown Product";

      // Sanitize product name to avoid terminal carriage return / newline artifacts
      const productName = String(rawProductName).replace(/[\r\n\t]+/g, " ").trim();

      matchingItems.push({
        productId: productIdStr,
        productName,
        quantity,
        unitCostPrice: unitCP,
        totalCostPrice: Math.round(totalCP * 100) / 100,
        sellingPrice: Math.round(sp * 100) / 100,
        profit: Math.round(itemProfit * 100) / 100,
        profitMarginPercent:
          sp > 0 ? Math.round(((itemProfit / sp) * 100) * 10) / 10 : 0,
      });

      billCategoryQuantity += quantity;
      billCategoryCP += totalCP;
      billCategorySP += sp;
    }

    if (matchingItems.length > 0) {
      const billProfit = billCategorySP - billCategoryCP;
      const customerDoc = bill.customer
        ? customerMap.get(bill.customer.toString())
        : null;

      billsSummary.push({
        billId: bill.id,
        mongoId: bill._id.toString(),
        billDate: moment
          .tz(bill.date || bill.createdAt, IST)
          .format("YYYY-MM-DD HH:mm:ss"),
        customerName: (customerDoc?.name || "Walk-in Customer").replace(/[\r\n\t]+/g, " ").trim(),
        customerPhone: customerDoc?.phone || "-",
        itemsCount: matchingItems.length,
        items: matchingItems,
        totalQuantitySold: billCategoryQuantity,
        totalCP: Math.round(billCategoryCP * 100) / 100,
        totalSP: Math.round(billCategorySP * 100) / 100,
        profit: Math.round(billProfit * 100) / 100,
        profitMarginPercent:
          billCategorySP > 0
            ? Math.round(((billProfit / billCategorySP) * 100) * 10) / 10
            : 0,
      });

      grandTotalQuantity += billCategoryQuantity;
      grandTotalCP += billCategoryCP;
      grandTotalSP += billCategorySP;
      grandTotalProfit += billProfit;
    }
  }

  const grandProfitMargin =
    grandTotalSP > 0
      ? Math.round(((grandTotalProfit / grandTotalSP) * 100) * 100) / 100
      : 0;

  return {
    category: targetCategoryLower,
    startDate: formattedStartDate,
    endDate: formattedEndDate,
    isRange,
    dateDisplay,
    timezone: IST,
    totalBillsFound: billsSummary.length,
    bills: billsSummary,
    summary: {
      totalBillsWithCategory: billsSummary.length,
      totalQuantitySold: grandTotalQuantity,
      totalCP: Math.round(grandTotalCP * 100) / 100,
      totalSP: Math.round(grandTotalSP * 100) / 100,
      totalProfit: Math.round(grandTotalProfit * 100) / 100,
      profitMarginPercent: grandProfitMargin,
    },
  };
}

/**
 * Display formatted CLI report
 */
function printReport(result) {
  const { category, dateDisplay, isRange, totalBillsFound, bills, summary } = result;

  console.log("\n" + "=".repeat(75));
  console.log(`📊  CATEGORY SALES & PROFIT REPORT`);
  console.log(`    Category:   "${category.toUpperCase()}"`);
  console.log(`    ${isRange ? "Date Range: " : "Date:       "}${dateDisplay} (IST)`);
  console.log("=".repeat(75));

  if (totalBillsFound === 0) {
    console.log(
      `\n❌ No sales found for category "${category}" ${isRange ? `between ${dateDisplay}` : `on ${dateDisplay}`}.\n`
    );
    console.log("=".repeat(75));
    return;
  }

  console.log(
    `\n📜 Matching Bills (${totalBillsFound} bill${totalBillsFound > 1 ? "s" : ""}):\n`
  );

  bills.forEach((b, idx) => {
    console.log(
      ` [${idx + 1}] Bill #${b.billId}  |  ${b.billDate}  |  Customer: ${b.customerName}`
    );
    b.items.forEach((it) => {
      console.log(
        `     • ${it.productName.padEnd(25)} Qty: ${String(it.quantity).padStart(3)} | CP: ₹${it.totalCostPrice.toFixed(2).padStart(8)} | SP: ₹${it.sellingPrice.toFixed(2).padStart(8)} | Profit: ₹${it.profit.toFixed(2).padStart(8)} (${it.profitMarginPercent}%)`
      );
    });
    console.log(
      `     ---------------------------------------------------------------------`
    );
    console.log(
      `     Subtotal: Qty: ${b.totalQuantitySold} | CP: ₹${b.totalCP.toFixed(2)} | SP: ₹${b.totalSP.toFixed(2)} | Profit: ₹${b.profit.toFixed(2)} (${b.profitMarginPercent}%)\n`
    );
  });

  console.log("=".repeat(75));
  console.log(
    `📈  SUMMARY TOTALS FOR "${category.toUpperCase()}" (${dateDisplay})`
  );
  console.log("=".repeat(75));
  console.log(`  • Bills Count:         ${summary.totalBillsWithCategory}`);
  console.log(`  • Total Quantity Sold: ${summary.totalQuantitySold} units`);
  console.log(`  • Total Cost Price:    ₹${summary.totalCP.toFixed(2)}  (CP / Investment)`);
  console.log(`  • Total Selling Price: ₹${summary.totalSP.toFixed(2)}  (SP / Revenue)`);
  console.log(`  • Total Profit:        ₹${summary.totalProfit.toFixed(2)}  (SP - CP)`);
  console.log(`  • Profit Margin:       ${summary.profitMarginPercent}%`);
  console.log("=".repeat(75) + "\n");
}

/**
 * Display help & sample categories from DB
 */
async function showHelpAndCategories() {
  console.log(`
Usage:
  # Single Day:
  node src/scripts/calculate-category-sales.js <category> <date> [options]

  # Date Range:
  node src/scripts/calculate-category-sales.js <category> <startDate> <endDate> [options]

Arguments:
  <category>    Category name (e.g., "cigarette", "biscuits", "cold drink", "soap")
  <date>        Single Date: YYYY-MM-DD (e.g. 2026-10-13), DD-MM-YYYY, "today", or "yesterday"
  <startDate>   Start Date of range (e.g. 2026-10-10)
  <endDate>     End Date of range (e.g. 2026-10-13)

Options:
  --category=<cat>   Specify category flag
  --date=<date>      Specify single date flag
  --start=<date>     Specify start date flag
  --end=<date>       Specify end date flag
  --shop=<slug|id>   Filter by specific shop
  --json             Output raw JSON data
  --help, -h         Show this help message
`);

  try {
    const mongoUri =
      process.env.MONGO_URI ||
      process.env.MONGODB_URI ||
      "mongodb://localhost:27017/invosync";

    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
    const db = mongoose.connection.db;

    const [distinctCategories, latestBill] = await Promise.all([
      db.collection("products").distinct("category"),
      db.collection("bills").findOne(
        {},
        { sort: { createdAt: -1 }, projection: { date: 1, createdAt: 1 } }
      ),
    ]);

    const validCats = distinctCategories.filter(
      (c) => c && c.trim() && c.toLowerCase() !== "null"
    );

    console.log("Available Product Categories in DB:");
    console.log(" ", validCats.join(", "));

    if (latestBill) {
      const latestDate = moment
        .tz(latestBill.date || latestBill.createdAt, IST)
        .format("YYYY-MM-DD");
      console.log(`\nMost recent bill date in DB: ${latestDate}`);
      console.log(`Example commands:`);
      console.log(`  node src/scripts/calculate-category-sales.js "${validCats[0] || "cigarette"}" "${latestDate}"`);
      console.log(`  node src/scripts/calculate-category-sales.js "${validCats[0] || "cigarette"}" "2026-10-10" "${latestDate}"\n`);
    }

    await mongoose.disconnect();
  } catch {
    // Ignore error in help display
  }
}

/**
 * CLI Entry Point
 */
async function main() {
  const options = parseArgs();

  if (options.help || (!options.category && !options.startDate)) {
    await showHelpAndCategories();
    process.exit(0);
  }

  if (!options.category) {
    console.error("❌ Error: Missing <category> argument.");
    console.log('Example: node src/scripts/calculate-category-sales.js "cigarette" "2026-10-13"');
    process.exit(1);
  }

  if (!options.startDate) {
    console.error("❌ Error: Missing date argument.");
    console.log('Example: node src/scripts/calculate-category-sales.js "cigarette" "2026-10-13"');
    console.log('Example (Range): node src/scripts/calculate-category-sales.js "cigarette" "2026-10-10" "2026-10-13"');
    process.exit(1);
  }

  const mongoUri =
    process.env.MONGO_URI ||
    process.env.MONGODB_URI ||
    "mongodb://localhost:27017/invosync";

  try {
    if (!options.json) {
      console.log("Connecting to MongoDB...");
    }

    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 10000,
    });

    const result = await calculateCategorySales({
      category: options.category,
      startDate: options.startDate,
      endDate: options.endDate,
      shopIdOrSlug: options.shop,
    });

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printReport(result);
    }
  } catch (error) {
    console.error("❌ Execution Error:", error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  calculateCategorySales,
  parseDateRange,
};

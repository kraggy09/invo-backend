import axios from "axios";

/**
 * Send a Discord notification to the given webhook URL.
 * Falls back to the global DISCORD_WEBHOOK_URL env variable.
 * In multi-tenant mode, pass the shop-specific webhook URL from Shop.settings.discordWebhookUrl.
 */
export const sendDiscordNotification = async (
  data: any,
  webhookUrl?: string,
) => {
  const url = webhookUrl;
  if (!url) {
    console.error(
      "No Discord webhook URL configured. Set DISCORD_WEBHOOK_URL or shop.settings.discordWebhookUrl.",
    );
    return;
  }

  try {
    const payload =
      typeof data === "string" ? { content: data } : { embeds: [data] };
    await axios.post(url, payload);
  } catch (error: any) {
    console.error("Error sending Discord notification:", error.message);
  }
};

export const formatBillNotification = (bill: any) => {
  const customerName = bill.customer?.name || "Walk-in Customer";
  const billId = bill.id;
  const date = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  const total = bill.total;
  const ruleName = bill.rule?.name || "Notification Rule";

  const itemsInfo = bill.matchingItems
    .map(
      (item: any) =>
        `• **${item.productSnapshot.name}** (Qty: ${item.quantity})`,
    )
    .join("\n");

  return {
    title: `🔔 Rule Triggered: ${ruleName}`,
    description: `A new bill has triggered a notification based on your settings.`,
    color: 0x2563eb, // InvoSync Blue
    fields: [
      {
        name: "Bill Details",
        value: `**#${billId}** | ₹${total}`,
        inline: true,
      },
      {
        name: "Customer",
        value: `**${customerName}**`,
        inline: true,
      },
      {
        name: "Matching Products",
        value: itemsInfo || "No specific items matched.",
        inline: false,
      },
    ],
    footer: {
      text: `InvoSync | ${date}`,
    },
    timestamp: new Date().toISOString(),
  };
};

import axios from "axios";

export const sendDiscordNotification = async (data: any) => {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) {
        console.error("DISCORD_WEBHOOK_URL is not defined in environment variables");
        return;
    }

    try {
        const payload = typeof data === 'string' ? { content: data } : { embeds: [data] };
        await axios.post(webhookUrl, payload);
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

    const itemsInfo = bill.matchingItems.map((item: any) =>
        `• **${item.productSnapshot.name}** (Qty: ${item.quantity})`
    ).join("\n");

    return {
        title: `🔔 Rule Triggered: ${ruleName}`,
        description: `A new bill has triggered a notification based on your settings.`,
        color: 0x2563EB, // InvoSync Blue
        fields: [
            {
                name: "Bill Details",
                value: `**#${billId}** | ₹${total}`,
                inline: true
            },
            {
                name: "Customer",
                value: `**${customerName}**`,
                inline: true
            },
            {
                name: "Matching Products",
                value: itemsInfo || "No specific items matched.",
                inline: false
            }
        ],
        footer: {
            text: `InvoSync | ${date}`,
        },
        timestamp: new Date().toISOString()
    };
};

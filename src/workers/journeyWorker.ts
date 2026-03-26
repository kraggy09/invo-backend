import { Worker, Job } from "bullmq";
import redisConnection from "../lib/redis";
import { addJourneyLog, addCustomerJourneyLog } from "../services/logger.service";
import { Server } from "socket.io";

export const initJourneyWorker = (io: Server) => {
    const worker = new Worker(
        "journey-logs",
        async (job: Job) => {
            const { journeyLog, customerJourneyLog } = job.data;

            console.log(`🌀 Processing background job: ${job.name} (ID: ${job.id})`);

            // Mock request object to provide Socket.IO instance to loggers
            const mockReq = {
                app: {
                    get: (name: string) => (name === "io" ? io : null),
                },
            };

            try {
                const tasks = [];

                if (journeyLog) {
                    tasks.push(
                        addJourneyLog(
                            mockReq,
                            journeyLog.eventType,
                            journeyLog.message,
                            journeyLog.createdBy,
                            journeyLog.entityType,
                            journeyLog.entityId,
                            journeyLog.metadata
                        )
                    );
                }

                if (customerJourneyLog) {
                    tasks.push(
                        addCustomerJourneyLog(
                            mockReq,
                            customerJourneyLog.customerId,
                            customerJourneyLog.eventType,
                            customerJourneyLog.message,
                            customerJourneyLog.createdBy,
                            customerJourneyLog.amount,
                            customerJourneyLog.adjustments,
                            customerJourneyLog.outstanding,
                            customerJourneyLog.billId,
                            customerJourneyLog.metadata
                        )
                    );
                }

                if (tasks.length > 0) {
                    await Promise.all(tasks);
                }
                console.log(`✅ Background job completed: ${job.name} (ID: ${job.id})`);
            } catch (error) {
                console.error(`❌ Background job failed: ${job.name} (ID: ${job.id})`, error);
                throw error; // Rethrow for retry logic
            }
        },
        {
            connection: redisConnection,
            concurrency: 5,
        }
    );

    worker.on("failed", async (job: Job | undefined, err: Error) => {
        if (!job) return;

        // Only notify if all retries are exhausted
        if (job.attemptsMade >= (job.opts.attempts || 3)) {
            console.error(`🚨 Job ${job.id} permanently failed after ${job.attemptsMade} attempts: ${err.message}`);
            await sendDiscordNotification(job, err);
        }
    });

    console.log("🚀 Journey worker started and listening for jobs");
    return worker;
};

const sendDiscordNotification = async (job: Job, err: Error) => {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) {
        console.warn("⚠️ DISCORD_WEBHOOK_URL not set, skipping failure notification.");
        return;
    }

    const embed = {
        title: "🔴 Background Job Failed",
        description: `Job: **${job.name}** | ID: \`${job.id}\``,
        color: 0xff0000,
        fields: [
            {
                name: "Attempt",
                value: `${job.attemptsMade}/${job.opts.attempts || 3}`,
                inline: true,
            },
            {
                name: "Error",
                value: err.message || "Unknown error",
                inline: false,
            },
            {
                name: "Payload",
                value: `\`\`\`json\n${JSON.stringify(job.data, null, 2).slice(0, 1000)}\n\`\`\``,
                inline: false,
            },
        ],
        timestamp: new Date().toISOString(),
    };

    try {
        const response = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ embeds: [embed] }),
        });

        if (!response.ok) {
            console.error(`❌ Discord webhook failed: ${response.status} ${response.statusText}`);
        }
    } catch (error) {
        console.error("❌ Failed to send Discord notification:", error);
    }
};

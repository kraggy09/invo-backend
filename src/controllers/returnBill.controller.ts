import { Request, Response } from "express";
import mongoose, { ClientSession } from "mongoose";
import ReturnBill from "../models/returnBill.model";
import Bill from "../models/bill.model";
import Customer from "../models/customer.model";
import Product from "../models/product.model";
import Transaction from "../models/transaction.model";
import Counter from "../models/counter.model";
import ApiResponse from "../utils/ApiResponse";
import { ApiError, getCurrentDateAndTime } from "../utils";
import Stock from "../models/stock.model";
import moment from "moment-timezone";

const IST = "Asia/Kolkata";
import { EVENTS_MAP } from "../constant/redisMap";
import { journeyQueue } from "../queues/journeyQueue";

// Helper function to extract logged-in user ID
const getUserId = (req: any) => {
    return req.user ? req.user._id : "65be87db40026e6f47700000"; // Fallback
};

export const createReturnBill = async (req: Request, res: Response) => {
    const { originalBillId, customerId, items, paymentMode, totalAmount, idempotencyKey } = req.body;

    if (idempotencyKey) {
        const existingReturnBill = await ReturnBill.findOne({ idempotencyKey })
            .populate("customer")
            .populate("createdBy", "name username")
            .populate("items.product");

        if (existingReturnBill) {
            const transaction = await Transaction.findOne({
                idempotencyKey
            }).sort({ createdAt: -1 });

            const stockLogs = await Stock.find({ returnBill: existingReturnBill._id })
                .populate("product", "name stock")
                .populate("createdBy", "name username");

            return ApiResponse(res, 200, true, "Return bill already exists (Idempotent)", {
                returnBill: existingReturnBill,
                transaction,
                stockLogs,
                updatedOutstanding: existingReturnBill.newOutstanding
            });
        }
    }
    const createdBy = getUserId(req);

    const session: ClientSession = await mongoose.startSession();

    try {
        const result = await session.withTransaction(async () => {
            // 1. Validations
            const originalBill = await Bill.findById(originalBillId).session(session);
            if (!originalBill) throw new ApiError(404, "Original Bill not found");

            if (originalBill.customer?.toString() !== customerId) {
                throw new ApiError(400, "Customer mismatch with Original Bill");
            }

            const customer = await Customer.findById(customerId).session(session);
            if (!customer) throw new ApiError(404, "Customer not found");

            // Verify item quantities against original bill
            const existingReturns = await ReturnBill.find({ originalBill: originalBillId }).session(session);

            const returnedItemQuantities = new Map<string, number>();
            existingReturns.forEach((rb) => {
                rb.items.forEach((item: any) => {
                    const pid = item.product.toString();
                    returnedItemQuantities.set(pid, (returnedItemQuantities.get(pid) || 0) + item.quantityReturned);
                });
            });

            const originalItemQuantities = new Map<string, number>();
            originalBill.items.forEach((item: any) => {
                const pid = item.product?._id ? item.product._id.toString() : item.product.toString();
                originalItemQuantities.set(pid, (originalItemQuantities.get(pid) || 0) + item.quantity);
            });

            let calculatedTotal = 0;
            const productBulkOps: any[] = [];
            const stockLogOps: any[] = [];
            const productIds = items.map((i: any) => new mongoose.Types.ObjectId(i.product));

            const availableProducts = await Product.find({ _id: { $in: productIds } }, { stock: 1 }).session(session);
            const productMap = new Map<string, any>();
            availableProducts.forEach((p: any) => productMap.set(p._id.toString(), p));

            for (const item of items) {
                const pIdStr = item.product.toString();

                if (!productMap.has(pIdStr)) {
                    throw new ApiError(404, `Product ${pIdStr} not found in database`);
                }

                const originalQty = originalItemQuantities.get(pIdStr) || 0;
                const alreadyReturnedQty = returnedItemQuantities.get(pIdStr) || 0;

                if (item.quantityReturned + alreadyReturnedQty > originalQty) {
                    throw new ApiError(400, `Cannot return more than purchased for product ${pIdStr}`);
                }

                calculatedTotal += item.returnTotal;

                // Stock Update
                productBulkOps.push({
                    updateOne: {
                        filter: { _id: new mongoose.Types.ObjectId(item.product) },
                        update: { $inc: { stock: item.quantityReturned } },
                    },
                });

                // Prepare Stock Request for logging
                const p = productMap.get(pIdStr);
                const oldStock = p.stock || 0;
                stockLogOps.push({
                    insertOne: {
                        document: {
                            approvedBy: createdBy,
                            product: new mongoose.Types.ObjectId(item.product),
                            oldStock: oldStock,
                            stockAtUpdate: oldStock,
                            quantity: item.quantityReturned,
                            newStock: oldStock + item.quantityReturned,
                            approved: true,
                            purpose: "PRODUCT_RETURN",
                            createdBy: createdBy,
                            date: moment.tz(getCurrentDateAndTime(), IST),
                        }
                    }
                });
            }

            // Check total against client passed total
            if (Math.abs(calculatedTotal - totalAmount) > 1) {
                throw new ApiError(400, `Total Amount mismatch. Calculated: ${calculatedTotal}, Provided: ${totalAmount}`);
            }

            // 2. Generate new ID
            const newReturnBillIdCounter = await Counter.findOneAndUpdate(
                { name: "returnBillId" },
                { $inc: { value: 1 } },
                { new: true, upsert: true, session }
            );

            if (!newReturnBillIdCounter) {
                throw new ApiError(500, "Error generating Return Bill ID");
            }

            // 3. Create ReturnBill
            const [newReturnBill] = await ReturnBill.create(
                [
                    {
                        id: newReturnBillIdCounter.value,
                        originalBill: originalBillId,
                        customer: customerId,
                        createdBy: createdBy,
                        items,
                        totalAmount: calculatedTotal,
                        productsTotal: calculatedTotal, // Using calculatedTotal as the productsTotal for the return
                        previousOutstanding: customer.outstanding, // Capture snapshot of outstanding before modification
                        paymentMode,
                        idempotencyKey,
                        // newOutstanding will be set after payment logic if ADJUSTMENT mode
                    },
                ],
                { session }
            );

            if (productBulkOps.length > 0) {
                // Update stockLogOps with the new returnBill ID
                stockLogOps.forEach((op: any) => {
                    if (op.insertOne && op.insertOne.document) {
                        op.insertOne.document.returnBill = newReturnBill._id;
                    }
                });

                const bulkResult = await Product.bulkWrite(productBulkOps, { session });
                if (bulkResult.modifiedCount !== items.length) {
                    throw new ApiError(500, "Product stock update mismatch");
                }

                const stockLogResult = await Stock.bulkWrite(stockLogOps, { session });
                if (stockLogResult.insertedCount !== items.length) {
                    throw new ApiError(500, "Failed to insert stock records for returns");
                }
            }

            // Fetch created stock logs to send back
            const stockLogs = await Stock.find({ returnBill: newReturnBill._id })
                .populate("product", "name stock")
                .populate("createdBy", "name username")
                .session(session);

            // 5. Handle Payment Logic
            let transaction = null;
            let newOutstanding = customer.outstanding;

            if (paymentMode === "ADJUSTMENT") {
                newOutstanding = customer.outstanding - calculatedTotal;
                await Customer.findByIdAndUpdate(customerId, { outstanding: newOutstanding }, { session });
                newReturnBill.newOutstanding = newOutstanding;
                await newReturnBill.save({ session });

                const transCounter = await Counter.findOneAndUpdate(
                    { name: "transactionId" },
                    { $inc: { value: 1 } },
                    { new: true, session }
                );

                if (!transCounter) throw new ApiError(500, "Error generating transaction ID");

                const [createdTransaction] = await Transaction.create(
                    [
                        {
                            id: transCounter.value,
                            name: customer.name,
                            purpose: "PRODUCT_RETURN",
                            amount: calculatedTotal,
                            previousOutstanding: customer.outstanding,
                            newOutstanding: newOutstanding,
                            paymentMode: "ADJUSTMENT",
                            approved: true,
                            paymentIn: true,
                            approvedBy: createdBy,
                            customer: customer._id,
                            idempotencyKey,
                        },
                    ],
                    { session }
                );
                transaction = createdTransaction;
            } else if (paymentMode === "CASH") {
                newReturnBill.newOutstanding = customer.outstanding;
                await newReturnBill.save({ session });
                const transCounter = await Counter.findOneAndUpdate(
                    { name: "transactionId" },
                    { $inc: { value: 1 } },
                    { new: true, session }
                );

                if (!transCounter) throw new ApiError(500, "Error generating transaction ID");

                const [createdTransaction] = await Transaction.create(
                    [
                        {
                            id: transCounter.value,
                            name: customer.name,
                            purpose: "PRODUCT_RETURN",
                            amount: calculatedTotal,
                            previousOutstanding: customer.outstanding,
                            newOutstanding: customer.outstanding,
                            paymentMode: "CASH",
                            approved: true,
                            paymentIn: false,
                            approvedBy: createdBy,
                            customer: customer._id,
                            idempotencyKey,
                        },
                    ],
                    { session }
                );
                transaction = createdTransaction;
            }

            return {
                returnBill: newReturnBill,
                transaction,
                stockLogs,
                updatedOutstanding: newOutstanding
            };
        });

        const populatedRB = await ReturnBill.findById(result.returnBill._id)
            .populate("customer")
            .populate("createdBy", "name username")
            .populate("items.product");

        // Socket Emit
        const io = req.app.get("io");
        if (io) {
            io.emit(EVENTS_MAP.RETURN_BILL_CREATED, {
                returnBill: populatedRB,
                transaction: result.transaction,
                stockLogs: result.stockLogs,
                updatedOutstanding: result.updatedOutstanding,
                socketId: req.headers.socketid
            });

            // Additionally emit INVENTORY_UPDATE_REQUEST to update inventory request views
            io.emit("INVENTORY_UPDATE_REQUEST", result.stockLogs);
        }

        // Journey Log (Offload to background queue)
        journeyQueue.add("return-bill-created", {
            journeyLog: {
                eventType: "PRODUCT_RETURN",
                message: `Return Bill #${populatedRB?.id} created for ${(populatedRB?.customer as any)?.name || "Customer"}. Total Returned: ₹${populatedRB?.totalAmount}. Mode: ${populatedRB?.paymentMode}`,
                createdBy,
                entityType: "ReturnBill",
                entityId: populatedRB?._id,
                metadata: {
                    originalBillId,
                    itemsCount: items.length,
                    paymentMode,
                    totalAmount
                }
            },
            customerJourneyLog: {
                customerId,
                eventType: "PRODUCT_RETURN",
                message: `Return Bill #${populatedRB?.id} created for ₹${populatedRB?.totalAmount}. Mode: ${populatedRB?.paymentMode}`,
                createdBy,
                amount: totalAmount,
                previousOutstanding: populatedRB?.previousOutstanding,
                outstanding: populatedRB?.newOutstanding,
                billId: populatedRB?._id,
                metadata: { originalBillId, itemsCount: items.length, paymentMode }
            }
        });

        return ApiResponse(res, 201, true, "Return bill created successfully", {
            returnBill: populatedRB,
            transaction: result.transaction,
            stockLogs: result.stockLogs,
            updatedOutstanding: result.updatedOutstanding
        });

    } catch (error: any) {
        console.error("❌ Return Bill creation error:", error);
        if (error instanceof ApiError) {
            return ApiResponse(res, error.statusCode, false, error.message);
        }
        return ApiResponse(res, 500, false, error.message || "Server Error");
    } finally {
        session.endSession();
    }
};

export const getAllReturnBills = async (req: Request, res: Response) => {
    try {
        const { startDate, endDate, page = 1, limit = 10 } = req.query;

        let query: any = {};
        if (startDate && endDate) {
            const start = moment.tz(startDate as string, IST).startOf("day").toDate();
            const end = moment.tz(endDate as string, IST).endOf("day").toDate();
            query.createdAt = { $gte: start, $lte: end };
        }

        const skip = (Number(page) - 1) * Number(limit);

        const [returnBills, total] = await Promise.all([
            ReturnBill.find(query)
                .populate("customer", "name phone")
                .populate("createdBy", "name username")
                .populate("items.product", "name")
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(Number(limit))
                .lean(),
            ReturnBill.countDocuments(query),
        ]);

        return ApiResponse(res, 200, true, "Return bills fetched", {
            returnBills,
            total,
            page: Number(page),
            limit: Number(limit),
        });
    } catch (error: any) {
        console.error(error);
        return ApiResponse(res, 500, false, "Server error", error.message);
    }
};

export const getReturnBillsSummary = async (req: Request, res: Response) => {
    try {
        const { startDate, endDate } = req.query;

        if (!startDate || !endDate) {
            return ApiResponse(
                res,
                400,
                false,
                "Both startDate and endDate are required"
            );
        }

        const start = moment.tz(startDate as string, IST).startOf("day").toDate();
        const end = moment.tz(endDate as string, IST).endOf("day").toDate();

        const returnStats = await ReturnBill.aggregate([
            {
                $match: {
                    createdAt: { $gte: start, $lte: end },
                },
            },
            {
                $group: {
                    _id: null,
                    totalReturnAmount: { $sum: "$totalAmount" },
                    totalProductsAmount: { $sum: "$productsTotal" },
                    count: { $sum: 1 },
                },
            },
        ]);

        const result = {
            totalReturnAmount: returnStats[0]?.totalReturnAmount || 0,
            totalProductsAmount: returnStats[0]?.totalProductsAmount || 0,
            returnCount: returnStats[0]?.count || 0,
        };

        return ApiResponse(res, 200, true, "Return bills summary calculated", result);
    } catch (error: any) {
        return ApiResponse(res, 500, false, error.message || "Server Error");
    }
};

export const getReturnBillById = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const returnBill = await ReturnBill.findById(id)
            .populate("customer")
            .populate("createdBy", "name username")
            .populate("originalBill")
            .populate("items.product");

        if (!returnBill) {
            return ApiResponse(res, 404, false, "Return bill not found");
        }

        return ApiResponse(res, 200, true, "Return bill found", { returnBill });
    } catch (error: any) {
        console.error(error);
        return ApiResponse(res, 500, false, "Server error", error.message);
    }
};

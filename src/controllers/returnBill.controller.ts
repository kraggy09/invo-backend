import { Response } from "express";
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
import { AuthenticatedRequest } from "../utils/AuthenticatedRequest";

const IST = "Asia/Kolkata";
import { EVENTS_MAP } from "../constant/redisMap";
import { journeyQueue } from "../queues/journeyQueue";
import { scopedMatch } from "../utils/scopedMatch";

// Helper function to extract logged-in user ID
const getUserId = (req: any) => {
    return req.user ? req.user._id : "65be87db40026e6f47700000"; // Fallback
};

export const createReturnBill = async (req: AuthenticatedRequest, res: Response) => {
    const shopId = req.shopId!;
    const { originalBillId, customerId, items, paymentMode, totalAmount, idempotencyKey } = req.body;

    if (idempotencyKey) {
        const existingReturnBill = await ReturnBill.findOne({ shopId, idempotencyKey })
            .populate("customer")
            .populate("originalBill")
            .populate("createdBy", "name username")
            .populate("approvedBy", "name username")
            .populate("rejectedBy", "name username")
            .populate("items.product");

        if (existingReturnBill) {
            const transaction = await Transaction.findOne({
                shopId,
                idempotencyKey: `${idempotencyKey}-tx`
            }).sort({ createdAt: -1 });

            const stockLogs = await Stock.find({ shopId, returnBill: existingReturnBill._id })
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
            // 1. Validations — IDOR prevention: all lookups scoped to shopId
            const originalBill = await Bill.findOne({ _id: originalBillId, shopId }).session(session);
            if (!originalBill) throw new ApiError(404, "Original Bill not found");

            if (originalBill.customer?.toString() !== customerId) {
                throw new ApiError(400, "Customer mismatch with Original Bill");
            }

            const customer = await Customer.findOne({ _id: customerId, shopId }).session(session);
            if (!customer) throw new ApiError(404, "Customer not found");

            // Verify item quantities against original bill — SCOPED (only consider active non-rejected returns)
            const existingReturns = await ReturnBill.find({
                shopId,
                originalBill: originalBillId,
                status: { $ne: "REJECTED" }
            }).session(session);

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
            const productIds = items.map((i: any) => new mongoose.Types.ObjectId(i.product));

            // Products must also belong to this shop
            const availableProducts = await Product.find({ _id: { $in: productIds }, shopId }, { stock: 1 }).session(session);
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
            }

            if (Math.abs(calculatedTotal - totalAmount) > 1) {
                throw new ApiError(400, `Total Amount mismatch. Calculated: ${calculatedTotal}, Provided: ${totalAmount}`);
            }

            // 2. Generate new ID — SCOPED to this shop
            const newReturnBillIdCounter = await Counter.findOneAndUpdate(
                { shopId, name: "returnBillId" },
                { $inc: { value: 1 } },
                { new: true, upsert: true, session }
            );

            if (!newReturnBillIdCounter) {
                throw new ApiError(500, "Error generating Return Bill ID");
            }

            // 3. Create ReturnBill in PENDING status (no stock or customer balance change yet)
            const [newReturnBill] = await ReturnBill.create(
                [
                    {
                        shopId,
                        id: newReturnBillIdCounter.value,
                        originalBill: originalBillId,
                        customer: customerId,
                        createdBy: createdBy,
                        items,
                        totalAmount: calculatedTotal,
                        productsTotal: calculatedTotal,
                        previousOutstanding: customer.outstanding,
                        newOutstanding: customer.outstanding, // Remains unadjusted until admin approves
                        paymentMode,
                        status: "PENDING",
                        idempotencyKey,
                    },
                ],
                { session }
            );

            return {
                returnBill: newReturnBill,
            };
        });

        const populatedRB = await ReturnBill.findOne({ _id: result.returnBill._id, shopId })
            .populate("customer")
            .populate("originalBill")
            .populate("createdBy", "name username")
            .populate("items.product");

        // Socket Emit — notify shop room of pending return bill
        const io = req.app.get("io");
        if (io) {
            io.to(`shop:${shopId}`).emit(EVENTS_MAP.RETURN_BILL_CREATED, {
                returnBill: populatedRB,
                socketId: req.headers.socketid
            });
        }

        // System Journey Log for creation / pending approval
        journeyQueue.add("return-bill-created", {
            shopId: shopId.toString(),
            journeyLog: {
                eventType: "PRODUCT_RETURN",
                message: `Return Bill #${populatedRB?.id} initiated for ${(populatedRB?.customer as any)?.name || "Customer"} (Pending Admin Approval). Total: ₹${populatedRB?.totalAmount}. Mode: ${populatedRB?.paymentMode}`,
                createdBy,
                entityType: "ReturnBill",
                entityId: populatedRB?._id,
                metadata: {
                    originalBillId,
                    itemsCount: items.length,
                    paymentMode,
                    totalAmount,
                    status: "PENDING"
                }
            }
        });

        return ApiResponse(res, 201, true, "Return bill initiated successfully and is pending admin approval", {
            returnBill: populatedRB,
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

export const approveReturnBill = async (req: AuthenticatedRequest, res: Response) => {
    const shopId = req.shopId!;
    const { id } = req.params;
    const userId = getUserId(req);

    const session: ClientSession = await mongoose.startSession();

    try {
        const result = await session.withTransaction(async () => {
            const returnBill = await ReturnBill.findOne({ _id: id, shopId }).session(session);
            if (!returnBill) throw new ApiError(404, "Return bill not found");

            if (returnBill.status !== "PENDING") {
                throw new ApiError(400, `Cannot approve return bill with status ${returnBill.status}`);
            }

            const customer = await Customer.findOne({ _id: returnBill.customer, shopId }).session(session);
            if (!customer) throw new ApiError(404, "Customer not found");

            // Validate outstanding balance - exact match required just like transaction approvals
            if (
                returnBill.previousOutstanding === undefined ||
                returnBill.previousOutstanding === null ||
                Math.abs(customer.outstanding - returnBill.previousOutstanding) > 0.01
            ) {
                throw new ApiError(
                    400,
                    "Outstanding balance does not match, please check",
                    { customer, returnBill }
                );
            }

            const productIds = returnBill.items.map((i: any) => new mongoose.Types.ObjectId(i.product));
            const availableProducts = await Product.find({ _id: { $in: productIds }, shopId }, { stock: 1 }).session(session);
            const productMap = new Map<string, any>();
            availableProducts.forEach((p: any) => productMap.set(p._id.toString(), p));

            const productBulkOps: any[] = [];
            const stockLogOps: any[] = [];

            for (const item of returnBill.items) {
                const pIdStr = item.product.toString();
                if (!productMap.has(pIdStr)) {
                    throw new ApiError(404, `Product ${pIdStr} not found in database`);
                }

                productBulkOps.push({
                    updateOne: {
                        filter: { _id: new mongoose.Types.ObjectId(item.product), shopId },
                        update: { $inc: { stock: item.quantityReturned } },
                    },
                });

                const p = productMap.get(pIdStr);
                const oldStock = p.stock || 0;
                stockLogOps.push({
                    insertOne: {
                        document: {
                            shopId,
                            approvedBy: userId,
                            product: new mongoose.Types.ObjectId(item.product),
                            oldStock: oldStock,
                            stockAtUpdate: oldStock,
                            quantity: item.quantityReturned,
                            newStock: oldStock + item.quantityReturned,
                            approved: true,
                            rejected: false,
                            purpose: "PRODUCT_RETURN",
                            returnBill: returnBill._id,
                            createdBy: userId,
                            date: moment.tz(getCurrentDateAndTime(), IST),
                        }
                    }
                });
            }

            if (productBulkOps.length > 0) {
                const bulkResult = await Product.bulkWrite(productBulkOps, { session });
                if (bulkResult.modifiedCount !== returnBill.items.length) {
                    throw new ApiError(500, "Product stock update mismatch");
                }

                const stockLogResult = await Stock.bulkWrite(stockLogOps, { session });
                if (stockLogResult.insertedCount !== returnBill.items.length) {
                    throw new ApiError(500, "Failed to insert stock records for returns");
                }
            }

            const stockLogs = await Stock.find({ shopId, returnBill: returnBill._id })
                .populate("product", "name stock")
                .populate("createdBy", "name username")
                .session(session);

            let transaction = null;
            const previousOutstanding = customer.outstanding;
            let newOutstanding = customer.outstanding;

            const transCounter = await Counter.findOneAndUpdate(
                { shopId, name: "transactionId" },
                { $inc: { value: 1 } },
                { new: true, upsert: true, session }
            );

            if (!transCounter) throw new ApiError(500, "Error generating transaction ID");

            if (returnBill.paymentMode === "ADJUSTMENT") {
                newOutstanding = customer.outstanding - returnBill.totalAmount;
                await Customer.findOneAndUpdate({ _id: customer._id, shopId }, { outstanding: newOutstanding }, { session });

                const [createdTransaction] = await Transaction.create(
                    [
                        {
                            shopId,
                            id: transCounter.value,
                            name: customer.name,
                            purpose: "PRODUCT_RETURN",
                            amount: returnBill.totalAmount,
                            previousOutstanding: previousOutstanding,
                            newOutstanding: newOutstanding,
                            paymentMode: "ADJUSTMENT",
                            approved: true,
                            paymentIn: true,
                            approvedBy: userId,
                            customer: customer._id,
                            idempotencyKey: returnBill.idempotencyKey ? `${returnBill.idempotencyKey}-tx` : undefined,
                        },
                    ],
                    { session }
                );
                transaction = createdTransaction;
            } else if (returnBill.paymentMode === "CASH") {
                const [createdTransaction] = await Transaction.create(
                    [
                        {
                            shopId,
                            id: transCounter.value,
                            name: customer.name,
                            purpose: "PRODUCT_RETURN",
                            amount: returnBill.totalAmount,
                            previousOutstanding: previousOutstanding,
                            newOutstanding: previousOutstanding,
                            paymentMode: "CASH",
                            approved: true,
                            paymentIn: false,
                            approvedBy: userId,
                            customer: customer._id,
                            idempotencyKey: returnBill.idempotencyKey ? `${returnBill.idempotencyKey}-tx` : undefined,
                        },
                    ],
                    { session }
                );
                transaction = createdTransaction;
            }

            returnBill.status = "APPROVED";
            returnBill.approvedBy = userId as any;
            returnBill.approvedAt = moment.tz(getCurrentDateAndTime(), IST).toDate();
            returnBill.previousOutstanding = previousOutstanding;
            returnBill.newOutstanding = newOutstanding;
            await returnBill.save({ session });

            return {
                returnBill,
                transaction,
                stockLogs,
                updatedOutstanding: newOutstanding
            };
        });

        const populatedRB = await ReturnBill.findOne({ _id: result.returnBill._id, shopId })
            .populate("customer")
            .populate("originalBill")
            .populate("createdBy", "name username")
            .populate("approvedBy", "name username")
            .populate("items.product");

        let populatedTransaction = null;
        if (result.transaction?._id) {
            populatedTransaction = await Transaction.findOne({ _id: result.transaction._id, shopId })
                .populate("customer")
                .populate("approvedBy", "name username");
        }

        const io = req.app.get("io");
        if (io) {
            const txToEmit = populatedTransaction || result.transaction;
            const txIdToEmit = txToEmit?.id;

            io.to(`shop:${shopId}`).emit(EVENTS_MAP.RETURN_BILL_APPROVED, {
                returnBill: populatedRB,
                transaction: txToEmit,
                transactionId: txIdToEmit,
                stockLogs: result.stockLogs,
                updatedOutstanding: result.updatedOutstanding,
                socketId: req.headers.socketid
            });

            if (populatedRB?.customer) {
                const customerObj = typeof populatedRB.customer === "object"
                    ? { ...(populatedRB.customer as any).toObject?.() || populatedRB.customer, outstanding: result.updatedOutstanding }
                    : { _id: populatedRB.customer, outstanding: result.updatedOutstanding };

                io.to(`shop:${shopId}`).emit(EVENTS_MAP.CUSTOMER_UPDATED, {
                    ...customerObj,
                    customer: customerObj,
                    updatedCustomer: customerObj,
                    socketId: req.headers.socketid
                });
            }

            if (txToEmit) {
                io.to(`shop:${shopId}`).emit(EVENTS_MAP.TRANSACTION_CREATED, {
                    transaction: txToEmit,
                    transactionId: txIdToEmit,
                    customer: populatedRB?.customer,
                    socketId: req.headers.socketid
                });
            }

            io.to(`shop:${shopId}`).emit("INVENTORY_UPDATE_REQUEST", result.stockLogs);
        }

        journeyQueue.add("return-bill-approved", {
            shopId: shopId.toString(),
            journeyLog: {
                eventType: "PRODUCT_RETURN",
                message: `Return Bill #${populatedRB?.id} approved by ${(req.user as any)?.name || "Admin"}. Total: ₹${populatedRB?.totalAmount}. Mode: ${populatedRB?.paymentMode}`,
                createdBy: userId,
                entityType: "ReturnBill",
                entityId: populatedRB?._id,
                metadata: {
                    originalBillId: populatedRB?.originalBill,
                    itemsCount: populatedRB?.items?.length,
                    paymentMode: populatedRB?.paymentMode,
                    totalAmount: populatedRB?.totalAmount,
                }
            },
            customerJourneyLog: {
                customerId: (populatedRB?.customer as any)?._id || populatedRB?.customer,
                eventType: "PRODUCT_RETURN",
                message: `Return Bill #${populatedRB?.id} of ₹${populatedRB?.totalAmount} approved. Mode: ${populatedRB?.paymentMode}`,
                createdBy: userId,
                amount: populatedRB?.totalAmount,
                previousOutstanding: populatedRB?.previousOutstanding,
                outstanding: populatedRB?.newOutstanding,
                billId: populatedRB?._id,
                metadata: {
                    originalBillId: populatedRB?.originalBill,
                    itemsCount: populatedRB?.items?.length,
                    paymentMode: populatedRB?.paymentMode,
                }
            }
        });

        return ApiResponse(res, 200, true, "Return bill approved successfully", {
            returnBill: populatedRB,
            transaction: populatedTransaction || result.transaction,
            stockLogs: result.stockLogs,
            updatedOutstanding: result.updatedOutstanding
        });

    } catch (error: any) {
        console.error("❌ Return Bill approval error:", error);
        if (error instanceof ApiError) {
            return ApiResponse(res, error.statusCode, false, error.message, error.data);
        }
        return ApiResponse(res, 500, false, error.message || "Server Error");
    } finally {
        session.endSession();
    }
};

export const rejectReturnBill = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const shopId = req.shopId!;
        const { id } = req.params;
        const { reason = "Rejected by admin" } = req.body;
        const userId = getUserId(req);

        const returnBill = await ReturnBill.findOne({ _id: id, shopId });
        if (!returnBill) {
            return ApiResponse(res, 404, false, "Return bill not found");
        }

        if (returnBill.status !== "PENDING") {
            return ApiResponse(res, 400, false, `Cannot reject return bill in ${returnBill.status} state`);
        }

        returnBill.status = "REJECTED";
        returnBill.rejectedBy = userId as any;
        returnBill.rejectedAt = moment.tz(getCurrentDateAndTime(), IST).toDate();
        returnBill.rejectionReason = reason;
        await returnBill.save();

        const populatedRB = await ReturnBill.findOne({ _id: returnBill._id, shopId })
            .populate("customer")
            .populate("originalBill")
            .populate("createdBy", "name username")
            .populate("rejectedBy", "name username")
            .populate("items.product");

        const io = req.app.get("io");
        if (io) {
            io.to(`shop:${shopId}`).emit(EVENTS_MAP.RETURN_BILL_REJECTED, {
                returnBill: populatedRB,
                socketId: req.headers.socketid
            });
        }

        journeyQueue.add("return-bill-rejected", {
            shopId: shopId.toString(),
            journeyLog: {
                eventType: "PRODUCT_RETURN",
                message: `Return Bill #${populatedRB?.id} rejected by ${(req.user as any)?.name || "Admin"}. Reason: ${reason}`,
                createdBy: userId,
                entityType: "ReturnBill",
                entityId: populatedRB?._id,
                metadata: { reason }
            }
        });

        return ApiResponse(res, 200, true, "Return bill rejected successfully", {
            returnBill: populatedRB
        });

    } catch (error: any) {
        console.error("❌ Return Bill rejection error:", error);
        return ApiResponse(res, 500, false, error.message || "Server Error");
    }
};

export const getAllReturnBills = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const shopId = req.shopId!;
        const { startDate, endDate, status, page = 1, limit = 10 } = req.query;

        let query: any = { shopId };

        if (status && status !== "ALL") {
            query.status = status;
        }

        if (startDate && endDate) {
            const start = moment.tz(startDate as string, IST).startOf("day").toDate();
            const end = moment.tz(endDate as string, IST).endOf("day").toDate();
            query.createdAt = { $gte: start, $lte: end };
        }

        const skip = (Number(page) - 1) * Number(limit);

        const [returnBills, total] = await Promise.all([
            ReturnBill.find(query)
                .populate("customer", "name phone outstanding")
                .populate("originalBill")
                .populate("createdBy", "name username")
                .populate("approvedBy", "name username")
                .populate("rejectedBy", "name username")
                .populate("items.product", "name stock")
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

export const getReturnBillsSummary = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const shopId = req.shopId!;
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
            scopedMatch(shopId, {
                $or: [{ status: "APPROVED" }, { status: { $exists: false } }],
                createdAt: { $gte: start, $lte: end },
            }),
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

export const getReturnBillById = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const shopId = req.shopId!;
        const { id } = req.params;
        // IDOR prevention: must belong to this shop
        const returnBill = await ReturnBill.findOne({ _id: id, shopId })
            .populate("customer")
            .populate("createdBy", "name username")
            .populate("approvedBy", "name username")
            .populate("rejectedBy", "name username")
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

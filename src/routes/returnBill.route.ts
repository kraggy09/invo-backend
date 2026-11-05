import express from "express";
import {
    createReturnBill,
    getAllReturnBills,
    getReturnBillById,
    getReturnBillsSummary,
    approveReturnBill,
    rejectReturnBill,
} from "../controllers/returnBill.controller";
import { isAllowed, verifyToken } from "../services/token.service";

const router = express.Router();
const adminRoles = ["SUPER_ADMIN", "ADMIN", "CREATOR"];

router.use(verifyToken);

router.post("/", createReturnBill);
router.get("/", getAllReturnBills);
router.get("/summary", getReturnBillsSummary);
router.get("/:id", getReturnBillById);
router.post("/:id/approve", isAllowed(adminRoles), approveReturnBill);
router.post("/:id/reject", isAllowed(adminRoles), rejectReturnBill);

export default router;

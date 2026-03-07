import express from "express";
import {
    createReturnBill,
    getAllReturnBills,
    getReturnBillById,
} from "../controllers/returnBill.controller";
import { verifyToken } from "../services/token.service";

const router = express.Router();

router.use(verifyToken);

router.post("/", createReturnBill);
router.get("/", getAllReturnBills);
router.get("/:id", getReturnBillById);

export default router;

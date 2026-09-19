import express from "express";
import { createShop, getAllShops, getShopProfile, updateShopSettings } from "../controllers/shop.controller";
import { verifyToken, isAllowed } from "../services/token.service";

const shopRouter = express.Router();

// Platform-level: create a new shop (no auth required — platform admin uses env key or separate mechanism)
shopRouter.route("/create").post(createShop);
// Platform-level: list all shops
shopRouter.route("/").get(getAllShops);

// Tenant-level: shop profile and settings (requires auth + SUPER_ADMIN role)
shopRouter.route("/profile").get(verifyToken, getShopProfile);
shopRouter.route("/settings").put(verifyToken, isAllowed(["SUPER_ADMIN", "ADMIN"]), updateShopSettings);

export default shopRouter;

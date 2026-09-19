import express from "express";
import { login, register, checkAuth, selectShop, switchShop } from "../controllers/user.controller";
import { verifyToken } from "../services/token.service";

const userRouter = express.Router();

userRouter.route("/login").post(login);
userRouter.route("/register").post(register);
userRouter.route("/select-shop").post(selectShop);  // Multi-shop selection after login
userRouter.route("/check-auth").get(verifyToken, checkAuth);
userRouter.route("/switch-shop").post(verifyToken, switchShop); // Switch to a different shop

export default userRouter;

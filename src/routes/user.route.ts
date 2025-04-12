import express from "express";
import { login, register, checkAuth } from "../controllers/user.controller";
import { verifyToken } from "../services/token.service";

const userRouter = express.Router();

userRouter.route("/login").post(login);
userRouter.route("/register").post(register);
userRouter.route("/check-auth").get(verifyToken, checkAuth);

export default userRouter;

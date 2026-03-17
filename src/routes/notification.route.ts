import express from "express";
import { createNotification, getNotifications, deleteNotification } from "../controllers/notification.controller";

const notificationRouter = express.Router();

notificationRouter.post("/", createNotification);
notificationRouter.get("/", getNotifications);
notificationRouter.delete("/:id", deleteNotification);

export default notificationRouter;

import express from "express";
import {
  addUserToCompany,
  getAllUsers,
  getAdminData,
} from "../controllers/admin.controller";
const adminRouter = express.Router();

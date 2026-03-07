import express from "express";
import { getJourneyLogs } from "../controllers/journey.controller";

const journeyRouter = express.Router();

journeyRouter.get("/", getJourneyLogs as any);

export default journeyRouter;

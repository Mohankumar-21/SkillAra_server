import express from "express";
import { z } from "zod";

import { listOrganizationTypes } from "../controllers/platformMasterController.js";
import { requireDb } from "../utils/db-state.js";

const router = express.Router();

router.get("/", requireDb, listOrganizationTypes);

export default router;

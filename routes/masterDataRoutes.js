import express from "express";
import { z } from "zod";
import {
  createMasterDataItem,
  deleteMasterDataItem,
  getMasterCategories,
  getMasterDataItem,
  listMasterData,
  updateMasterDataItem,
} from "../controllers/masterDataController.js";
import { MASTER_DATA_CATEGORY_KEYS } from "../data/masterDataCatalog.js";
import { requireAuth, requireRole, requireTenant } from "../middlewares/auth.js";
import { requireDb } from "../utils/db-state.js";
import { validateBody } from "../utils/validate.js";

const router = express.Router();

const categorySchema = z.enum(MASTER_DATA_CATEGORY_KEYS);

const codeSchema = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .refine((v) => v === "" || /^[A-Z0-9]{3}$/.test(v), {
    message: "Code must be exactly 3 letters or numbers",
  });

const createSchema = z.object({
  category: categorySchema,
  name: z.string().trim().min(2).max(80),
  code: codeSchema.optional(),
  description: z.string().trim().max(500).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

const updateSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    code: codeSchema.optional(),
    description: z.string().trim().max(500).optional(),
    status: z.enum(["active", "inactive"]).optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "No fields to update" });

router.get(
  "/categories",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "ORG_ADMIN"),
  requireTenant,
  getMasterCategories
);

router.get(
  "/",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "ORG_ADMIN"),
  requireTenant,
  listMasterData
);

router.get(
  "/:id",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "ORG_ADMIN"),
  requireTenant,
  getMasterDataItem
);

router.post(
  "/",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "ORG_ADMIN"),
  requireTenant,
  validateBody(createSchema),
  createMasterDataItem
);

router.patch(
  "/:id",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "ORG_ADMIN"),
  requireTenant,
  validateBody(updateSchema),
  updateMasterDataItem
);

router.delete(
  "/:id",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "ORG_ADMIN"),
  requireTenant,
  deleteMasterDataItem
);

export default router;

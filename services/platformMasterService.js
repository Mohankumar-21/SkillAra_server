import mongoose from "mongoose";
import Tenant from "../models/Tenant.js";
import logger from "../core/logger.js";
import { DEFAULT_ORGANIZATION_TYPES } from "../data/platformMasterCatalog.js";
import { getPlatformRoleCatalogAdmin } from "./roleService.js";

const CODE_RE = /^[A-Z0-9]{3}$/;

export function normalizeLookupForApi(item, organizationCount = 0) {
  if (!item) return null;
  const doc = item.toObject ? item.toObject() : item;
  return {
    id: String(doc._id),
    _id: doc._id,
    name: doc.name,
    code: String(doc.code || "").toUpperCase(),
    organizationCount: Number(organizationCount) || 0,
    status: doc.status,
    sortOrder: doc.sortOrder ?? 0,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/** Build a 3-character uppercase code from a name (e.g. "Training Institute" → "TRI"). */
export function slugifyOrgTypeCode(name) {
  const words = String(name || "")
    .trim()
    .split(/[\s-_]+/)
    .filter(Boolean);
  let code = words.map((w) => w[0] || "").join("").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length < 3) {
    code = (code + String(name || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase()).slice(0, 3);
  }
  code = code.slice(0, 3).padEnd(3, "X");
  return code;
}

function normalizeCode(value, fallbackName = "") {
  const raw = String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (raw.length === 3) return raw;
  if (!raw) return slugifyOrgTypeCode(fallbackName);
  return raw.slice(0, 3).padEnd(3, "X");
}

function findLookupById(items, id) {
  if (!id) return null;
  return items.find((item) => String(item._id) === String(id));
}

function findLookupByName(items, name) {
  if (!name) return null;
  const normalized = String(name).trim().toLowerCase();
  return items.find((item) => item.name.trim().toLowerCase() === normalized);
}

async function getCatalogAdmin() {
  const admin = await getPlatformRoleCatalogAdmin();
  if (!admin) return null;
  if (!Array.isArray(admin.organizationTypes)) admin.organizationTypes = [];
  return admin;
}

async function countByOrgTypeId(ids) {
  const uniqueIds = [...new Set((ids || []).filter(Boolean).map(String))];
  if (!uniqueIds.length) return new Map();

  const objectIds = uniqueIds
    .filter((id) => mongoose.isValidObjectId(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  if (!objectIds.length) return new Map();

  const rows = await Tenant.aggregate([
    { $match: { orgTypeId: { $in: objectIds } } },
    { $group: { _id: "$orgTypeId", count: { $sum: 1 } } },
  ]);

  return new Map(rows.map((r) => [String(r._id), r.count]));
}

export async function listOrganizationTypes({ activeOnly = false } = {}) {
  const admin = await getCatalogAdmin();
  if (!admin) return [];

  let items = [...admin.organizationTypes];
  if (activeOnly) items = items.filter((item) => item.status === "active");

  const counts = await countByOrgTypeId(items.map((item) => item._id));
  return items
    .map((item) => normalizeLookupForApi(item, counts.get(String(item._id)) || 0))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name));
}

export async function getOrganizationTypeById(id, { activeOnly = true } = {}) {
  const admin = await getCatalogAdmin();
  if (!admin || !id) return null;
  const item = findLookupById(admin.organizationTypes, id);
  if (!item) return null;
  if (activeOnly && item.status !== "active") return null;
  return item;
}

export async function createOrganizationType(data) {
  const admin = await getCatalogAdmin();
  if (!admin) throw new Error("Platform catalog admin not found");

  const name = String(data.name || "").trim();
  if (name.length < 2) {
    const err = new Error("Name too short");
    err.code = "VALIDATION";
    throw err;
  }

  const code = normalizeCode(data.code, name);
  if (!CODE_RE.test(code)) {
    const err = new Error("Code must be exactly 3 characters");
    err.code = "VALIDATION";
    throw err;
  }

  if (
    admin.organizationTypes.some(
      (item) =>
        item.name.trim().toLowerCase() === name.toLowerCase() ||
        String(item.code || "").toUpperCase() === code
    )
  ) {
    const err = new Error("Organization type exists");
    err.code = 11000;
    throw err;
  }

  admin.organizationTypes.push({
    name,
    code,
    status: data.status === "inactive" ? "inactive" : "active",
    sortOrder: Number(data.sortOrder ?? admin.organizationTypes.length),
  });
  await admin.save();
  const created = admin.organizationTypes[admin.organizationTypes.length - 1];
  return normalizeLookupForApi(created, 0);
}

export async function updateOrganizationType(id, data) {
  const admin = await getCatalogAdmin();
  if (!admin) throw new Error("Platform catalog admin not found");

  const item = findLookupById(admin.organizationTypes, id);
  if (!item) return null;

  if (data.name !== undefined) {
    const name = String(data.name).trim();
    if (
      admin.organizationTypes.some(
        (entry) =>
          entry.name.trim().toLowerCase() === name.toLowerCase() &&
          String(entry._id) !== String(id)
      )
    ) {
      const err = new Error("Organization type exists");
      err.code = 11000;
      throw err;
    }
    item.name = name;
  }
  if (data.code !== undefined) {
    const code = normalizeCode(data.code, item.name);
    if (!CODE_RE.test(code)) {
      const err = new Error("Code must be exactly 3 characters");
      err.code = "VALIDATION";
      throw err;
    }
    if (
      admin.organizationTypes.some(
        (entry) =>
          String(entry.code || "").toUpperCase() === code &&
          String(entry._id) !== String(id)
      )
    ) {
      const err = new Error("Organization type exists");
      err.code = 11000;
      throw err;
    }
    item.code = code;
  }
  if (data.status !== undefined) item.status = data.status === "inactive" ? "inactive" : "active";
  if (data.sortOrder !== undefined) item.sortOrder = Number(data.sortOrder);

  await admin.save();
  const count = await Tenant.countDocuments({ orgTypeId: id });
  return normalizeLookupForApi(item, count);
}

export async function deleteOrganizationType(id) {
  const admin = await getCatalogAdmin();
  if (!admin) throw new Error("Platform catalog admin not found");

  const item = findLookupById(admin.organizationTypes, id);
  if (!item) return null;

  const inUse = await Tenant.countDocuments({ orgTypeId: id });
  if (inUse > 0) {
    const err = new Error("Organization type in use");
    err.code = "IN_USE";
    throw err;
  }

  admin.organizationTypes = admin.organizationTypes.filter(
    (entry) => String(entry._id) !== String(id)
  );
  await admin.save();
  return normalizeLookupForApi(item, 0);
}

export async function seedDefaultOrganizationTypes() {
  const admin = await getCatalogAdmin();
  if (!admin) return;

  let changed = false;

  // Normalize existing codes to 3 uppercase chars when possible.
  for (const item of admin.organizationTypes) {
    const current = String(item.code || "").trim().toUpperCase();
    if (CODE_RE.test(current)) {
      if (item.code !== current) {
        item.code = current;
        changed = true;
      }
      continue;
    }
    const next = normalizeCode(current, item.name);
    if (item.code !== next) {
      item.code = next;
      changed = true;
    }
  }

  DEFAULT_ORGANIZATION_TYPES.forEach((seed, index) => {
    const exists =
      findLookupByName(admin.organizationTypes, seed.name) ||
      admin.organizationTypes.some(
        (item) => String(item.code || "").toUpperCase() === seed.code
      );
    if (exists) return;
    admin.organizationTypes.push({
      name: seed.name,
      code: seed.code,
      status: "active",
      sortOrder: index,
    });
    changed = true;
  });

  if (changed) {
    await admin.save();
    logger.info("Seeded/normalized organization types on SuperAdmin");
  }
}

export async function resolveOrganizationTypeName(orgTypeId, fallback = "") {
  if (!orgTypeId) return fallback;
  const item = await getOrganizationTypeById(orgTypeId, { activeOnly: false });
  return item?.name || fallback;
}

import Tenant from "../models/Tenant.js";
import logger from "../core/logger.js";
import { DEFAULT_ORGANIZATION_TYPES } from "../data/platformMasterCatalog.js";
import { getPlatformRoleCatalogAdmin } from "./roleService.js";

export function normalizeLookupForApi(item) {
  if (!item) return null;
  const doc = item.toObject ? item.toObject() : item;
  return {
    id: String(doc._id),
    _id: doc._id,
    name: doc.name,
    code: doc.code || "",
    description: doc.description || "",
    status: doc.status,
    sortOrder: doc.sortOrder ?? 0,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function slugifyCode(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
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

export async function listOrganizationTypes({ activeOnly = false } = {}) {
  const admin = await getCatalogAdmin();
  if (!admin) return [];

  let items = [...admin.organizationTypes];
  if (activeOnly) items = items.filter((item) => item.status === "active");
  return items
    .map((item) => normalizeLookupForApi(item))
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

  const code = String(data.code || slugifyCode(name)).trim().toLowerCase();
  if (
    admin.organizationTypes.some(
      (item) =>
        item.name.trim().toLowerCase() === name.toLowerCase() ||
        (code && item.code === code)
    )
  ) {
    const err = new Error("Organization type exists");
    err.code = 11000;
    throw err;
  }

  admin.organizationTypes.push({
    name,
    code,
    description: String(data.description || "").trim(),
    status: data.status === "inactive" ? "inactive" : "active",
    sortOrder: Number(data.sortOrder ?? admin.organizationTypes.length),
  });
  await admin.save();
  return normalizeLookupForApi(admin.organizationTypes[admin.organizationTypes.length - 1]);
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
  if (data.code !== undefined) item.code = String(data.code).trim().toLowerCase();
  if (data.description !== undefined) item.description = String(data.description).trim();
  if (data.status !== undefined) item.status = data.status === "inactive" ? "inactive" : "active";
  if (data.sortOrder !== undefined) item.sortOrder = Number(data.sortOrder);

  await admin.save();
  return normalizeLookupForApi(item);
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
  return normalizeLookupForApi(item);
}

export async function seedDefaultOrganizationTypes() {
  const admin = await getCatalogAdmin();
  if (!admin) return;

  let changed = false;
  DEFAULT_ORGANIZATION_TYPES.forEach((seed, index) => {
    const exists =
      findLookupByName(admin.organizationTypes, seed.name) ||
      admin.organizationTypes.some((item) => item.code === seed.code);
    if (exists) return;
    admin.organizationTypes.push({
      name: seed.name,
      code: seed.code,
      description: "",
      status: "active",
      sortOrder: index,
    });
    changed = true;
  });

  if (changed) {
    await admin.save();
    logger.info("Seeded default organization types on SuperAdmin");
  }
}

export async function resolveOrganizationTypeName(orgTypeId, fallback = "") {
  if (!orgTypeId) return fallback;
  const item = await getOrganizationTypeById(orgTypeId, { activeOnly: false });
  return item?.name || fallback;
}

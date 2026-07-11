import Tenant from "../models/Tenant.js";
import TenantMasterData from "../models/TenantMasterData.js";
import User from "../models/User.js";
import logger from "../core/logger.js";
import {
  DEFAULT_MASTER_DATA_SEEDS,
  getMasterCategory,
  getTenantFieldForCategory,
  isValidMasterCategory,
  MASTER_DATA_CATEGORIES,
} from "../data/masterDataCatalog.js";

function ensureArray(tenant, field) {
  if (!Array.isArray(tenant[field])) tenant[field] = [];
  return tenant[field];
}

function findItemInArray(items, id) {
  if (!id) return null;
  return items.find((item) => String(item._id) === String(id)) || null;
}

function findItemByName(items, name) {
  const normalized = String(name || "").trim().toLowerCase();
  return items.find((item) => item.name.trim().toLowerCase() === normalized) || null;
}

export function normalizeMasterDataItem(doc, category, tenantId) {
  if (!doc) return null;
  const item = doc.toObject ? doc.toObject() : doc;
  return {
    id: String(item._id),
    _id: item._id,
    tenantId: String(tenantId),
    category,
    name: item.name,
    code: item.code || "",
    description: item.description || "",
    status: item.status,
    sortOrder: item.sortOrder ?? 0,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function listMasterCategories() {
  return MASTER_DATA_CATEGORIES.map((c) => ({
    key: c.key,
    label: c.label,
    labelPlural: c.labelPlural,
    userField: c.userField,
    description: c.description,
  }));
}

async function loadTenantForMasterData(tenantId) {
  return Tenant.findById(tenantId);
}

function getCategoryForItem(tenant, id) {
  for (const cat of MASTER_DATA_CATEGORIES) {
    const items = tenant[cat.tenantField] || [];
    if (findItemInArray(items, id)) return cat.key;
  }
  return null;
}

export async function seedTenantMasterData(tenantId) {
  const tenant = await loadTenantForMasterData(tenantId);
  if (!tenant) return [];

  let changed = false;
  const created = [];

  for (const category of MASTER_DATA_CATEGORIES) {
    const seeds = DEFAULT_MASTER_DATA_SEEDS[category.key] || [];
    if (!seeds.length) continue;

    const items = ensureArray(tenant, category.tenantField);
    for (const [index, name] of seeds.entries()) {
      const existing = findItemByName(items, name);
      if (existing) {
        created.push(normalizeMasterDataItem(existing, category.key, tenantId));
        continue;
      }
      items.push({
        name,
        status: "active",
        sortOrder: index,
      });
      created.push(
        normalizeMasterDataItem(items[items.length - 1], category.key, tenantId)
      );
      changed = true;
    }
  }

  if (changed) await tenant.save();
  return created;
}

/** Copy legacy TenantMasterData documents into Tenant embedded arrays, preserving _id. */
export async function migrateLegacyTenantMasterData() {
  let legacyItems = [];
  try {
    legacyItems = await TenantMasterData.find({}).lean();
  } catch {
    return false;
  }
  if (!legacyItems.length) return false;

  const byTenant = new Map();
  for (const item of legacyItems) {
    const key = String(item.tenantId);
    if (!byTenant.has(key)) byTenant.set(key, []);
    byTenant.get(key).push(item);
  }

  let migratedCount = 0;
  for (const [tenantId, items] of byTenant.entries()) {
    const tenant = await Tenant.findById(tenantId);
    if (!tenant) continue;

    let changed = false;
    for (const legacy of items) {
      const field = getTenantFieldForCategory(legacy.category);
      if (!field) continue;

      const array = ensureArray(tenant, field);
      const byId = findItemInArray(array, legacy._id);
      const byName = findItemByName(array, legacy.name);
      if (byId || byName) continue;

      array.push({
        _id: legacy._id,
        name: legacy.name,
        code: legacy.code || "",
        description: legacy.description || "",
        status: legacy.status || "active",
        sortOrder: legacy.sortOrder ?? 0,
        createdAt: legacy.createdAt,
        updatedAt: legacy.updatedAt,
      });
      changed = true;
      migratedCount++;
    }

    if (changed) await tenant.save();
  }

  if (migratedCount > 0) {
    logger.info(`Migrated ${migratedCount} legacy master data item(s) into Tenant documents`);
  }
  return migratedCount > 0;
}

export async function listMasterDataItems(tenantId, category, { status = null } = {}) {
  if (!isValidMasterCategory(category)) return null;

  await seedTenantMasterData(tenantId);

  const tenant = await loadTenantForMasterData(tenantId);
  if (!tenant) return [];

  const field = getTenantFieldForCategory(category);
  let items = [...ensureArray(tenant, field)];

  if (status === "active" || status === "inactive") {
    items = items.filter((item) => item.status === status);
  }

  items.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name));
  return items.map((item) => normalizeMasterDataItem(item, category, tenantId));
}

export async function getMasterDataItemById(tenantId, id) {
  const tenant = await loadTenantForMasterData(tenantId);
  if (!tenant) return null;

  const category = getCategoryForItem(tenant, id);
  if (!category) return null;

  const field = getTenantFieldForCategory(category);
  const item = findItemInArray(ensureArray(tenant, field), id);
  if (!item) return null;

  return { category, item, tenant };
}

export async function createMasterDataItem(tenantId, payload) {
  const category = String(payload.category || "").trim().toLowerCase();
  if (!isValidMasterCategory(category)) return { error: "MASTER_DATA_CATEGORY_INVALID" };

  const name = String(payload.name || "").trim();
  if (!name || name.length < 2) return { error: "MASTER_DATA_NAME_INVALID" };

  const tenant = await loadTenantForMasterData(tenantId);
  if (!tenant) return { error: "TENANT_NOT_FOUND" };

  const field = getTenantFieldForCategory(category);
  const items = ensureArray(tenant, field);

  if (findItemByName(items, name)) return { error: "MASTER_DATA_NAME_EXISTS" };

  items.push({
    name,
    code: String(payload.code || "").trim(),
    description: String(payload.description || "").trim(),
    status: payload.status === "inactive" ? "inactive" : "active",
    sortOrder: Number.isFinite(Number(payload.sortOrder)) ? Number(payload.sortOrder) : items.length,
  });

  await tenant.save();
  const created = items[items.length - 1];
  return { item: normalizeMasterDataItem(created, category, tenantId) };
}

export async function updateMasterDataItem(tenantId, id, updates) {
  const found = await getMasterDataItemById(tenantId, id);
  if (!found) return { error: "MASTER_DATA_NOT_FOUND" };

  const { category, item, tenant } = found;
  const field = getTenantFieldForCategory(category);
  const items = ensureArray(tenant, field);

  if (updates.name !== undefined) {
    const name = String(updates.name).trim();
    if (!name || name.length < 2) return { error: "MASTER_DATA_NAME_INVALID" };
    const duplicate = items.find(
      (entry) =>
        entry.name.trim().toLowerCase() === name.toLowerCase() &&
        String(entry._id) !== String(id)
    );
    if (duplicate) return { error: "MASTER_DATA_NAME_EXISTS" };
    item.name = name;
  }
  if (updates.code !== undefined) item.code = String(updates.code).trim();
  if (updates.description !== undefined) item.description = String(updates.description).trim();
  if (updates.status !== undefined) {
    item.status = updates.status === "inactive" ? "inactive" : "active";
  }
  if (updates.sortOrder !== undefined && Number.isFinite(Number(updates.sortOrder))) {
    item.sortOrder = Number(updates.sortOrder);
  }

  await tenant.save();
  return { item: normalizeMasterDataItem(item, category, tenantId) };
}

export async function deleteMasterDataItem(tenantId, id) {
  const found = await getMasterDataItemById(tenantId, id);
  if (!found) return { error: "MASTER_DATA_NOT_FOUND" };

  const { category, tenant } = found;
  const inUse = await countMasterDataUsage(tenantId, category, id);
  if (inUse > 0) return { error: "MASTER_DATA_IN_USE" };

  const field = getTenantFieldForCategory(category);
  tenant[field] = ensureArray(tenant, field).filter((entry) => String(entry._id) !== String(id));
  await tenant.save();
  return { ok: true };
}

export async function validateMasterDataRef(tenantId, category, id) {
  if (!id) return { ok: true, doc: null };
  if (!isValidMasterCategory(category)) return { error: "MASTER_DATA_CATEGORY_INVALID" };

  const found = await getMasterDataItemById(tenantId, id);
  if (!found || found.category !== category || found.item.status !== "active") {
    return { error: "MASTER_DATA_NOT_FOUND" };
  }
  return { ok: true, doc: found.item };
}

export async function countMasterDataUsage(tenantId, category, id) {
  const cat = getMasterCategory(category);
  if (!cat?.userField) return 0;
  return User.countDocuments({ tenantId, [cat.userField]: id });
}

export async function loadMasterDataMap(tenantId, ids) {
  const uniqueIds = [...new Set((ids || []).filter(Boolean).map(String))];
  if (!uniqueIds.length) return new Map();

  const tenant = await Tenant.findById(tenantId).select("departments designations");
  if (!tenant) return new Map();

  const all = [...(tenant.departments || []), ...(tenant.designations || [])];
  const idSet = new Set(uniqueIds);
  return new Map(
    all.filter((item) => idSet.has(String(item._id))).map((item) => [String(item._id), item])
  );
}

export async function attachMasterLabelsToUsers(users, tenantId) {
  const ids = [];
  users.forEach((u) => {
    const doc = u.toObject ? u.toObject() : u;
    if (doc.departmentId) ids.push(doc.departmentId);
    if (doc.designationId) ids.push(doc.designationId);
  });
  const map = await loadMasterDataMap(tenantId, ids);
  return { map };
}

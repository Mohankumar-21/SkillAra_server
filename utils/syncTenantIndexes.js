import Tenant from "../models/Tenant.js";
import logger from "../core/logger.js";

/** Legacy unique indexes that conflict with the current Tenant schema. */
const OBSOLETE_TENANT_INDEXES = ["sub_domain_1", "tenant_name_1"];

/**
 * Drop obsolete unique indexes left from older Tenant schemas.
 * Example bug: unique `sub_domain` allowed only one tenant to omit that field,
 * so creating a second org failed with a misleading TENANT_EXISTS error.
 */
export async function syncTenantIndexes() {
  const collection = Tenant.collection;
  let existing = [];
  try {
    existing = await collection.indexes();
  } catch (err) {
    logger.warn(`Could not list Tenant indexes: ${err.message}`);
    return;
  }

  const names = new Set(existing.map((idx) => idx.name));

  for (const name of OBSOLETE_TENANT_INDEXES) {
    if (!names.has(name)) continue;
    try {
      await collection.dropIndex(name);
      logger.info(`Dropped obsolete Tenant index: ${name}`);
    } catch (err) {
      logger.warn(`Failed to drop Tenant index ${name}: ${err.message}`);
    }
  }

  // email: unique among non-empty values (org contact email)
  const emailIdx = existing.find((idx) => idx.name === "email_1");
  if (emailIdx && (!emailIdx.unique || !emailIdx.sparse)) {
    try {
      await collection.dropIndex("email_1");
      await collection.createIndex({ email: 1 }, { unique: true, sparse: true, background: true });
      logger.info("Recreated Tenant email index as unique + sparse");
    } catch (err) {
      logger.warn(`Failed to fix Tenant email index: ${err.message}`);
    }
  } else if (!names.has("email_1")) {
    try {
      await collection.createIndex({ email: 1 }, { unique: true, sparse: true, background: true });
      logger.info("Created Tenant email unique sparse index");
    } catch (err) {
      logger.warn(`Failed to create Tenant email index: ${err.message}`);
    }
  }

  // Ensure subdomain unique index exists
  if (!names.has("subdomain_1")) {
    try {
      await collection.createIndex({ subdomain: 1 }, { unique: true, background: true });
      logger.info("Created Tenant subdomain unique index");
    } catch (err) {
      logger.warn(`Failed to create subdomain index: ${err.message}`);
    }
  }
}

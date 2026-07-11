import { prepareResponseMsg, sendError } from "../utils/helper.js";
import {
  countMasterDataUsage,
  createMasterDataItem,
  deleteMasterDataItem,
  getMasterDataItemById,
  listMasterCategories,
  listMasterDataItems,
  seedTenantMasterData,
  updateMasterDataItem,
} from "../services/masterDataService.js";
import { isValidMasterCategory } from "../data/masterDataCatalog.js";
import { writeAuditLog } from "../services/auditLog.js";

function slugifyCode(name) {
  return String(name || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 30);
}

export async function getMasterCategories(req, res, next) {
  try {
    return res
      .status(200)
      .send(
        prepareResponseMsg({ categories: listMasterCategories() }, true, "Master categories fetched", 200)
      );
  } catch (err) {
    return next(err);
  }
}

export async function listMasterData(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const category = String(req.query.category || "").trim().toLowerCase();
    const status = req.query.status ? String(req.query.status).trim().toLowerCase() : null;

    if (!isValidMasterCategory(category)) {
      return sendError(res, "MASTER_DATA_CATEGORY_INVALID", 400);
    }

    const items = await listMasterDataItems(tenantId, category, { status });
    return res.status(200).send(
      prepareResponseMsg(
        { items },
        true,
        "Master data fetched successfully",
        200
      )
    );
  } catch (err) {
    return next(err);
  }
}

export async function getMasterDataItem(req, res, next) {
  try {
    const found = await getMasterDataItemById(req.tenantId, req.params.id);
    if (!found) return sendError(res, "MASTER_DATA_NOT_FOUND", 404);
    const { category, item } = found;
    return res.status(200).send(
      prepareResponseMsg(
        {
          item: {
            id: String(item._id),
            _id: item._id,
            tenantId: String(req.tenantId),
            category,
            name: item.name,
            code: item.code || "",
            description: item.description || "",
            status: item.status,
            sortOrder: item.sortOrder ?? 0,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
          },
        },
        true,
        "Master data fetched",
        200
      )
    );
  } catch (err) {
    return next(err);
  }
}

export async function createMasterDataItemHandler(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const category = String(req.body.category || "").trim().toLowerCase();
    const name = String(req.body.name || "").trim();
    const description = String(req.body.description || "").trim();
    const code = String(req.body.code || slugifyCode(name)).trim();
    const status = req.body.status === "inactive" ? "inactive" : "active";
    const sortOrder = Number.isFinite(Number(req.body.sortOrder)) ? Number(req.body.sortOrder) : 0;

    const result = await createMasterDataItem(tenantId, {
      category,
      name,
      code,
      description,
      status,
      sortOrder,
    });

    if (result.error) {
      return sendError(res, result.error, result.error === "MASTER_DATA_NAME_EXISTS" ? 409 : 400);
    }

    await writeAuditLog({
      actorId: req.user._id || req.user.id,
      actorType: "tenant_user",
      action: "master_data.created",
      targetId: result.item._id,
      tenantId,
      ip: req.ip,
      metadata: { category, name: result.item.name },
    });

    return res
      .status(201)
      .send(
        prepareResponseMsg(
          { item: result.item },
          true,
          "Master data created successfully",
          201
        )
      );
  } catch (err) {
    return next(err);
  }
}

export async function updateMasterDataItemHandler(req, res, next) {
  try {
    const updates = {};
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.code !== undefined) updates.code = req.body.code;
    if (req.body.description !== undefined) updates.description = req.body.description;
    if (req.body.status !== undefined) updates.status = req.body.status;
    if (req.body.sortOrder !== undefined) updates.sortOrder = req.body.sortOrder;

    if (Object.keys(updates).length === 0) {
      return sendError(res, "MASTER_DATA_NO_FIELDS", 400);
    }

    const result = await updateMasterDataItem(req.tenantId, req.params.id, updates);
    if (result.error) {
      const status = result.error === "MASTER_DATA_NOT_FOUND" ? 404 : result.error === "MASTER_DATA_NAME_EXISTS" ? 409 : 400;
      return sendError(res, result.error, status);
    }

    return res
      .status(200)
      .send(
        prepareResponseMsg(
          { item: result.item },
          true,
          "Master data updated successfully",
          200
        )
      );
  } catch (err) {
    return next(err);
  }
}

export async function deleteMasterDataItemHandler(req, res, next) {
  try {
    const result = await deleteMasterDataItem(req.tenantId, req.params.id);
    if (result.error) {
      const status = result.error === "MASTER_DATA_NOT_FOUND" ? 404 : result.error === "MASTER_DATA_IN_USE" ? 409 : 400;
      return sendError(res, result.error, status);
    }

    return res
      .status(200)
      .send(prepareResponseMsg({ ok: true }, true, "Master data deleted successfully", 200));
  } catch (err) {
    return next(err);
  }
}

export async function seedMasterDataForTenant(req, res, next) {
  try {
    const items = await seedTenantMasterData(req.tenantId);
    return res.status(200).send(
      prepareResponseMsg(
        { items },
        true,
        "Master data seeded",
        200
      )
    );
  } catch (err) {
    return next(err);
  }
}

export {
  createMasterDataItemHandler as createMasterDataItem,
  updateMasterDataItemHandler as updateMasterDataItem,
  deleteMasterDataItemHandler as deleteMasterDataItem,
};

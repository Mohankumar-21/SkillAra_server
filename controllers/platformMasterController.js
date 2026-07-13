import { prepareResponseMsg, sendError } from "../utils/helper.js";
import {
  createOrganizationType,
  deleteOrganizationType,
  listOrganizationTypes,
  updateOrganizationType,
} from "../services/platformMasterService.js";

export const listOrganizationTypesHandler = async (req, res, next) => {
  try {
    const activeOnly = req.query.activeOnly !== "false";
    const items = await listOrganizationTypes({ activeOnly });
    return res.status(200).send(
      prepareResponseMsg({ organizationTypes: items }, true, "Organization types fetched", 200)
    );
  } catch (err) {
    return next(err);
  }
};

export const createOrganizationTypeHandler = async (req, res, next) => {
  try {
    const item = await createOrganizationType(req.body);
    return res.status(201).send(
      prepareResponseMsg({ organizationType: item }, true, "Organization type created", 201)
    );
  } catch (err) {
    if (err?.code === 11000) {
      return sendError(res, "ORG_TYPE_EXISTS", 409);
    }
    if (err?.code === "VALIDATION") {
      return sendError(res, "GENERAL_VALIDATION_FAILED", 400, { detail: err.message });
    }
    return next(err);
  }
};

export const updateOrganizationTypeHandler = async (req, res, next) => {
  try {
    const item = await updateOrganizationType(req.params.id, req.body);
    if (!item) {
      return sendError(res, "ORG_TYPE_NOT_FOUND", 404);
    }
    return res.status(200).send(
      prepareResponseMsg({ organizationType: item }, true, "Organization type updated", 200)
    );
  } catch (err) {
    if (err?.code === 11000) {
      return sendError(res, "ORG_TYPE_EXISTS", 409);
    }
    if (err?.code === "VALIDATION") {
      return sendError(res, "GENERAL_VALIDATION_FAILED", 400, { detail: err.message });
    }
    return next(err);
  }
};

export const deleteOrganizationTypeHandler = async (req, res, next) => {
  try {
    const item = await deleteOrganizationType(req.params.id);
    if (!item) {
      return sendError(res, "ORG_TYPE_NOT_FOUND", 404);
    }
    return res.status(200).send(
      prepareResponseMsg({ organizationType: item }, true, "Organization type deleted", 200)
    );
  } catch (err) {
    if (err?.code === "IN_USE") {
      return sendError(res, "ORG_TYPE_IN_USE", 409);
    }
    return next(err);
  }
};

export {
  listOrganizationTypesHandler as listOrganizationTypes,
  createOrganizationTypeHandler as createOrganizationType,
  updateOrganizationTypeHandler as updateOrganizationType,
  deleteOrganizationTypeHandler as deleteOrganizationType,
};

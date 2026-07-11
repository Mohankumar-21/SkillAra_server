/** Map API / legacy role & status values to canonical User schema values. */

const ROLE_TO_DB = {
  tenant_admin: "tenant_admin",
  TENANT_ADMIN: "tenant_admin",
  org_admin: "org_admin",
  ORG_ADMIN: "org_admin",
  instructor: "instructor",
  TUTOR: "instructor",
  INSTRUCTOR: "instructor",
  student: "student",
  STUDENT: "student",
};

const ROLE_TO_API = {
  tenant_admin: "TENANT_ADMIN",
  org_admin: "ORG_ADMIN",
  instructor: "TUTOR",
  student: "STUDENT",
};

const STATUS_TO_DB = {
  active: "active",
  ACTIVE: "active",
  invited: "invited",
  INVITED: "invited",
  PENDING: "invited",
  disabled: "disabled",
  DISABLED: "disabled",
};

const STATUS_TO_API = {
  active: "ACTIVE",
  invited: "INVITED",
  disabled: "DISABLED",
};

export const CREATABLE_API_ROLES = ["TUTOR", "STUDENT", "ORG_ADMIN"];

export function normalizeRoleForDb(role) {
  const key = String(role || "").trim();
  return ROLE_TO_DB[key] || ROLE_TO_DB[key.toLowerCase()] || null;
}

export function normalizeRoleForApi(role) {
  const db = normalizeRoleForDb(role) || String(role || "").toLowerCase();
  return ROLE_TO_API[db] || String(role || "").toUpperCase();
}

export function normalizeStatusForDb(status) {
  const key = String(status || "").trim();
  return STATUS_TO_DB[key] || STATUS_TO_DB[key.toLowerCase()] || "active";
}

export function normalizeStatusForApi(status) {
  const db = normalizeStatusForDb(status);
  return STATUS_TO_API[db] || "ACTIVE";
}

export function isCreatableEmployeeRole(role) {
  return CREATABLE_API_ROLES.includes(normalizeRoleForApi(role));
}

export function invitationStatusToDb(invitationStatus) {
  if (String(invitationStatus || "").toUpperCase() === "PENDING") return "invited";
  return "active";
}

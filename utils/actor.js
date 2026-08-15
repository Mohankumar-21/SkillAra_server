/**
 * Normalized view of the authenticated caller.
 *
 * `req.user` has two shapes depending on which middleware ran:
 *   - authenticate()       → { id, tenantId, role, type }   (RS256 token claims)
 *   - authenticateLegacy() → a full Mongoose User document   (legacy HS256 path)
 *
 * Controllers that read `req.user._id` silently get `undefined` under the first
 * shape, which is how ownership checks end up comparing against the string
 * "undefined". Always go through getActor() instead.
 */
import { normalizeRoleForApi } from "./userRoleMap.js";
import { isTenantAdminUser } from "./user.js";

function toApiRole(role) {
  return String(role || "")
    .trim()
    .toUpperCase()
    .replace(/-/g, "_");
}

/**
 * @returns {{id: string, tenantId: string|null, role: string, isSuperadmin: boolean,
 *            isTenantAdmin: boolean, isInstructor: boolean, isStudent: boolean}|null}
 */
export function getActor(req) {
  const raw = req?.user;
  if (!raw) return null;

  const doc = typeof raw.toObject === "function" ? raw.toObject() : raw;
  const id = String(doc.id ?? doc._id ?? "");
  if (!id) return null;

  const apiRole = toApiRole(doc.role);
  const isSuperadmin =
    doc.type === "superadmin" || apiRole === "SUPER_ADMIN" || apiRole === "SUPERADMIN";

  const isTenantAdmin = !isSuperadmin && isTenantAdminUser(doc);
  const isOrgAdmin = !isSuperadmin && apiRole === "ORG_ADMIN";

  let role = "STUDENT";
  if (isSuperadmin) role = "SUPER_ADMIN";
  else if (isTenantAdmin) role = "TENANT_ADMIN";
  else if (isOrgAdmin) role = "ORG_ADMIN";
  else role = normalizeRoleForApi(doc.role) || "STUDENT";

  return {
    id,
    tenantId: doc.tenantId != null ? String(doc.tenantId) : null,
    role,
    isSuperadmin,
    // Org admins get the same course-moderation reach as the owner within their tenant.
    isTenantAdmin: isTenantAdmin || isOrgAdmin,
    isInstructor: role === "TUTOR",
    isStudent: role === "STUDENT",
  };
}

/** True when the actor may moderate any course in the tenant (not just their own). */
export function canModerateCourses(actor) {
  return Boolean(actor && (actor.isSuperadmin || actor.isTenantAdmin));
}

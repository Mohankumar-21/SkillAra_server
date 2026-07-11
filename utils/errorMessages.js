/**
 * Central catalog of user-facing error messages.
 * Use error keys (not raw strings) in controllers, routes, and middleware.
 */
export const ERROR_MESSAGES = {
  GENERAL_UNKNOWN: "Something went wrong. Please try again.",
  GENERAL_VALIDATION_FAILED: "Please check your input and try again.",
  GENERAL_FORBIDDEN: "You don't have permission to perform this action.",
  GENERAL_UNAUTHORIZED: "Please sign in to continue.",
  GENERAL_NOT_FOUND: "The requested resource was not found.",
  GENERAL_SERVICE_UNAVAILABLE: "Service temporarily unavailable. Please try again shortly.",

  DB_UNAVAILABLE:
    "We're having trouble connecting to the database. Please try again in a moment.",

  AUTH_INVALID_CREDENTIALS: "The email or password you entered is incorrect.",
  AUTH_ACCOUNT_LOCKED:
    "Your account is temporarily locked after too many failed attempts. Please try again later.",
  AUTH_ACCOUNT_DISABLED: "This account has been disabled. Contact your administrator.",
  AUTH_ACCOUNT_BLOCKED: "This account has been blocked. Contact your administrator.",
  AUTH_TENANT_PANEL_DENIED: "This account cannot access the organization admin panel.",
  AUTH_SESSION_EXPIRED: "Your session has expired. Please sign in again.",
  AUTH_TENANT_REQUIRED: "Organization workspace could not be identified. Check your login URL.",
  AUTH_TENANT_WORKSPACE_REQUIRED:
    "Workspace subdomain is required. Use your organization URL (e.g. acme-bootcamp.localhost:5174/login).",
  AUTH_TENANT_INACTIVE: "This organization is currently inactive. Contact platform support.",
  AUTH_RATE_LIMITED: "Too many login attempts. Please wait a minute and try again.",
  AUTH_INVITE_PENDING: "Please complete your invitation signup before logging in.",
  AUTH_INVITE_INVALID: "This invitation link is invalid or has expired.",
  AUTH_MFA_INVALID: "Invalid or expired MFA verification. Please try again.",
  AUTH_REGISTRATION_CLOSED:
    "Open registration is disabled. Ask your organization admin for an invitation.",
  AUTH_PASSWORD_INCORRECT: "Your current password is incorrect.",

  TENANT_NOT_FOUND: "We couldn't find that organization. Check the workspace URL.",
  TENANT_INVALID_ID: "Invalid organization identifier.",
  TENANT_SUBDOMAIN_TAKEN: "This subdomain is already in use. Please choose another one.",
  TENANT_SUBDOMAIN_INVALID: "Subdomain format is invalid. Use lowercase letters, numbers, and hyphens.",
  TENANT_WORKSPACE_INVALID: "Invalid workspace name.",
  TENANT_WORKSPACE_NOT_FOUND: "Workspace not found.",
  TENANT_EXISTS: "An organization with this domain, subdomain, or email already exists.",
  TENANT_EMAIL_IN_USE: "This email is already in use by another organization.",
  TENANT_OWNER_ROLE_REQUIRED: "The organization owner must have the Organization Owner role.",
  TENANT_STATUS_INVALID: "Status must be true or false.",
  TENANT_CREATE_FAILED: "We couldn't create the organization. Please try again.",

  USER_NOT_FOUND: "User not found.",
  USER_EMAIL_EXISTS: "An account with this email already exists in this organization.",
  USER_ROLE_INVALID: "Role must be Tutor, Student, or Organization Admin.",
  USER_ORG_ADMIN_FORBIDDEN: "Only the Organization Owner can assign the Organization Admin role.",
  USER_OWNER_PROTECTED: "The organization owner cannot be modified from the users list.",
  USER_STATUS_INVALID: "Status must be Active or Disabled.",
  USER_SELF_STATUS: "You cannot change your own account status.",
  USER_SELF_DELETE: "You cannot delete your own account.",
  USER_NO_FIELDS: "No fields were provided to update.",

  ROLE_NOT_FOUND: "Role not found.",
  ROLE_NAME_INVALID: "Role name must be at least 2 characters.",
  ROLE_PROTECTED: "This system role cannot be deleted.",
  ROLE_OWNER_PROTECTED: "The organization owner role cannot be modified.",
  ROLE_IN_USE: "This role is assigned to users and cannot be deleted.",
  ROLE_NO_FIELDS: "No fields were provided to update.",
  ROLE_INVALID: "The selected role is invalid for this organization.",
  ROLE_OWNER_ASSIGN_FORBIDDEN: "The organization owner role cannot be assigned to other users.",

  MASTER_DATA_NOT_FOUND: "Master data item not found.",
  MASTER_DATA_CATEGORY_INVALID: "Invalid master data category.",
  MASTER_DATA_NAME_INVALID: "Name must be at least 2 characters.",
  MASTER_DATA_NAME_EXISTS: "An item with this name already exists in this category.",
  MASTER_DATA_IN_USE: "This item is assigned to users and cannot be deleted.",
  MASTER_DATA_NO_FIELDS: "No fields were provided to update.",

  PLAN_NOT_FOUND: "The selected plan was not found.",
  PLAN_INVALID: "The selected plan is invalid or no longer active.",
  PLAN_INVALID_ID: "Invalid plan identifier.",
  PLAN_NAME_EXISTS: "A plan with this name already exists.",
  PLAN_LIMIT_EXCEEDED: "Your plan limit has been reached. Please upgrade to continue.",
  PLAN_LIMIT_USERS: "Your plan's user limit has been reached. Upgrade to add more users.",
  PLAN_LIMIT_COURSES: "Your plan's course limit has been reached. Upgrade to add more courses.",
  PLAN_LIMIT_AI: "Your plan's AI usage limit has been reached. Upgrade or try again next month.",
  PLAN_AI_NOT_INCLUDED: "AI features are not included in your current plan.",
  PLAN_AI_EVALUATION: "AI evaluation is not included in your current plan.",
  PLAN_AI_SUMMARIZATION: "Content summarization is not included in your current plan.",
  PLAN_AI_ANALYTICS: "Predictive analytics is not included in your current plan.",
  PLAN_AI_MONTHLY_LIMIT: "Your monthly AI request limit has been reached.",

  OWNERSHIP_FORBIDDEN: "Only the organization owner can request an ownership transfer.",
  OWNERSHIP_SELF: "You cannot transfer ownership to yourself.",
  OWNERSHIP_PENDING_EXISTS: "A pending ownership transfer request already exists for this organization.",
  OWNERSHIP_TARGET_INELIGIBLE:
    "Only active Organization Admins who have accepted their invitation can become owner.",
  OWNERSHIP_TARGET_INVALID:
    "Target must be an active Organization Admin with an accepted invitation.",
  OWNERSHIP_REQUEST_NOT_FOUND: "Ownership transfer request not found or no longer pending.",
  OWNERSHIP_ORG_INACTIVE: "This organization is inactive. Ownership cannot be transferred.",
  OWNERSHIP_OWNER_INVALID: "The current organization owner is no longer valid.",
  OWNERSHIP_REJECT_REASON_REQUIRED: "Please provide a reason for rejecting this request.",

  COURSE_NOT_FOUND: "Course not found.",
  ENROLLMENT_NOT_FOUND: "Enrollment not found.",
  QUIZ_NOT_FOUND: "Quiz not found.",
  LESSON_NOT_FOUND: "Lesson not found.",

  UPLOAD_FILE_TYPE_INVALID: "This file type is not allowed.",
  UPLOAD_FILE_TOO_LARGE: "The file is too large. Please choose a smaller file.",
  AI_SERVICE_ERROR: "We couldn't complete the AI request. Please try again later.",

  VALIDATION_EMAIL_INVALID: "Please enter a valid email address.",
  VALIDATION_PASSWORD_WEAK: "Password must be at least 6 characters.",
};

const TECHNICAL_MESSAGE_PATTERNS = [
  /mongodb/i,
  /\bmongo/i,
  /E11000/,
  /ECONNREFUSED/,
  /ValidationError/i,
  /CastError/i,
  /SyntaxError/i,
  /TypeError/i,
  /ReferenceError/i,
  /\bat\s+\S+\s*\(/,
  /stack trace/i,
  /duplicate key error/i,
  /\$regex/i,
  /\$where/i,
  /BSON/i,
  /Mongoose/i,
  /MongoServer/i,
  /MongoNetwork/i,
  /connection.*refused/i,
  /ENOMEM/,
  /ENOENT/,
  /jwt/i,
  /token.*invalid/i,
  /Unexpected token/i,
  /Cannot read propert/i,
  /is not a function/i,
  /request entity too large/i,
];

/** @param {string} key */
export function getErrorMessage(key) {
  if (!key) return ERROR_MESSAGES.GENERAL_UNKNOWN;
  return ERROR_MESSAGES[key] ?? ERROR_MESSAGES.GENERAL_UNKNOWN;
}

/** @param {string} key */
export function isErrorKey(key) {
  return Boolean(key && ERROR_MESSAGES[key]);
}

/** @param {unknown} message */
export function isUserFacingMessage(message) {
  if (typeof message !== "string") return false;
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > 220) return false;
  if (isErrorKey(trimmed)) return true;
  if (Object.values(ERROR_MESSAGES).includes(trimmed)) return true;
  return !TECHNICAL_MESSAGE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * @param {unknown} message
 * @param {string} [fallbackKey="GENERAL_UNKNOWN"]
 */
export function sanitizeClientMessage(message, fallbackKey = "GENERAL_UNKNOWN") {
  if (isErrorKey(message)) return getErrorMessage(message);
  if (isUserFacingMessage(message)) return String(message).trim();
  return getErrorMessage(fallbackKey);
}

/** @param {import("zod").ZodError} zodError */
export function validationMessageFromZod(zodError) {
  const first = zodError?.issues?.[0];
  if (!first) return getErrorMessage("GENERAL_VALIDATION_FAILED");
  const field = first.path?.length ? first.path.join(".") : "input";
  return `Invalid ${field}: ${first.message}`;
}

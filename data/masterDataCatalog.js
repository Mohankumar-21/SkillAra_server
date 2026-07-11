/** Tenant master data categories — extend here for new lookup types. */

export const MASTER_DATA_CATEGORIES = [
  {
    key: "department",
    label: "Department",
    labelPlural: "Departments",
    tenantField: "departments",
    userField: "departmentId",
    description: "Organizational units used when assigning users.",
  },
  {
    key: "designation",
    label: "Designation",
    labelPlural: "Designations",
    tenantField: "designations",
    userField: "designationId",
    description: "Job titles and roles within the organization.",
  },
];

export const MASTER_DATA_CATEGORY_KEYS = MASTER_DATA_CATEGORIES.map((c) => c.key);

/** Default departments seeded for each new tenant. */
export const DEFAULT_DEPARTMENT_SEEDS = [
  "Academics",
  "Operations",
  "Finance",
  "Human Resources",
  "Support",
  "Technology",
  "Marketing",
  "General",
];

/** Default designations seeded for each new tenant. */
export const DEFAULT_DESIGNATION_SEEDS = [
  "Instructor",
  "Senior Instructor",
  "Teaching Assistant",
  "Course Coordinator",
  "Program Manager",
  "Academic Head",
  "Administrator",
  "Trainer",
];

/** Default lookup values per master data category — extend when adding categories. */
export const DEFAULT_MASTER_DATA_SEEDS = {
  department: DEFAULT_DEPARTMENT_SEEDS,
  designation: DEFAULT_DESIGNATION_SEEDS,
};

export function getDefaultSeedsForCategory(category) {
  return DEFAULT_MASTER_DATA_SEEDS[String(category || "").trim()] || [];
}

export function getMasterCategory(key) {
  return MASTER_DATA_CATEGORIES.find((c) => c.key === key) || null;
}

export function getTenantFieldForCategory(category) {
  return getMasterCategory(category)?.tenantField || null;
}

export function isValidMasterCategory(category) {
  return MASTER_DATA_CATEGORY_KEYS.includes(String(category || "").trim());
}

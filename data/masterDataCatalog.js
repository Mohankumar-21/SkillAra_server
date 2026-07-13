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

/** Default departments seeded for each new tenant (code is exactly 3 chars). */
export const DEFAULT_DEPARTMENT_SEEDS = [
  {
    name: "Academics",
    code: "ACA",
    description: "Teaching, curriculum, and academic program operations.",
  },
  {
    name: "Support",
    code: "SUP",
    description: "Learner support, helpdesk, and service operations.",
  },
  {
    name: "Technology",
    code: "TEC",
    description: "Platform, product, and technical infrastructure.",
  },
];

/** Default designations seeded for each new tenant (code is exactly 3 chars). */
export const DEFAULT_DESIGNATION_SEEDS = [
  {
    name: "Instructor",
    code: "INS",
    description: "Delivers courses and supports learner progress.",
  },
  {
    name: "Senior Instructor",
    code: "SIN",
    description: "Leads instructional delivery and mentors instructors.",
  },
  {
    name: "Teaching Assistant",
    code: "TAS",
    description: "Assists instructors with sessions, grading, and learner support.",
  },
  {
    name: "Course Coordinator",
    code: "CCO",
    description: "Coordinates course schedules, content readiness, and delivery logistics.",
  },
  {
    name: "Program Manager",
    code: "PMG",
    description: "Owns program outcomes, timelines, and cross-team coordination.",
  },
  {
    name: "Academic Head",
    code: "AHD",
    description: "Provides academic leadership and quality oversight.",
  },
  {
    name: "Administrator",
    code: "ADM",
    description: "Handles organizational administration and operational tasks.",
  },
  {
    name: "Trainer",
    code: "TRN",
    description: "Facilitates training sessions and skill-building workshops.",
  },
];

/** Default lookup values per master data category — extend when adding categories. */
export const DEFAULT_MASTER_DATA_SEEDS = {
  department: DEFAULT_DEPARTMENT_SEEDS,
  designation: DEFAULT_DESIGNATION_SEEDS,
};

export function normalizeMasterSeed(seed) {
  if (typeof seed === "string") {
    return { name: seed, code: "", description: "" };
  }
  return {
    name: String(seed?.name || "").trim(),
    code: String(seed?.code || "").trim().toUpperCase(),
    description: String(seed?.description || "").trim(),
  };
}

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

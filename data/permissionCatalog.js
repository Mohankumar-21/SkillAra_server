/** Permission module catalogs — source of truth for tenant and platform RBAC. */

export const TENANT_PERMISSION_MODULES = [
  { id: "dashboard", label: "Dashboard", actions: ["view", "export"] },
  { id: "users", label: "Users", actions: ["view", "create", "edit", "delete", "assign", "export", "import", "manage"] },
  { id: "roles", label: "Roles & Permissions", actions: ["view", "create", "edit", "delete", "clone", "assign", "configure", "manage"] },
  { id: "courses", label: "Courses", actions: ["view", "create", "edit", "delete", "publish", "archive", "assign", "export", "approve"] },
  { id: "course-categories", label: "Course Categories", actions: ["view", "create", "edit", "delete", "manage"] },
  { id: "course-modules", label: "Course Modules", actions: ["view", "create", "edit", "delete", "publish", "archive"] },
  { id: "lessons", label: "Lessons", actions: ["view", "create", "edit", "delete", "publish", "archive", "approve"] },
  { id: "assignments", label: "Assignments", actions: ["view", "create", "edit", "delete", "assign", "approve", "export"] },
  { id: "question-bank", label: "Question Bank", actions: ["view", "create", "edit", "delete", "import", "export", "manage"] },
  { id: "quizzes", label: "Quizzes", actions: ["view", "create", "edit", "delete", "publish", "assign", "approve"] },
  { id: "mock-tests", label: "Mock Tests", actions: ["view", "create", "edit", "delete", "publish", "assign", "approve"] },
  { id: "mock-interviews", label: "Mock Interviews", actions: ["view", "create", "edit", "delete", "manage"] },
  { id: "live-sessions", label: "Live Sessions", actions: ["view", "create", "edit", "delete", "manage"] },
  { id: "certificates", label: "Certificates", actions: ["view", "create", "edit", "delete", "approve", "export"] },
  { id: "mentorship", label: "Mentorship", actions: ["view", "create", "edit", "delete", "assign", "claim", "close", "manage"] },
  { id: "learners", label: "Learners", actions: ["view", "create", "edit", "delete", "assign", "export"] },
  { id: "instructors", label: "Instructors", actions: ["view", "create", "edit", "delete", "assign", "manage"] },
  { id: "mentors", label: "Mentors", actions: ["view", "create", "edit", "delete", "assign"] },
  { id: "community", label: "Community", actions: ["view", "create", "edit", "delete", "moderate", "manage"] },
  { id: "forum", label: "Forum", actions: ["view", "create", "edit", "delete", "approve", "moderate"] },
  { id: "notifications", label: "Notifications", actions: ["view", "create", "edit", "configure", "manage"] },
  { id: "reports", label: "Reports", actions: ["view", "export", "configure"] },
  { id: "analytics", label: "Analytics", actions: ["view", "export", "configure"] },
  { id: "org-settings", label: "Organization Settings", actions: ["view", "edit", "configure", "manage"] },
  { id: "branding", label: "Branding", actions: ["view", "edit", "configure"] },
  { id: "security", label: "Security", actions: ["view", "configure", "manage"] },
  { id: "audit-logs", label: "Audit Logs", actions: ["view", "export"] },
];

export const PLATFORM_PERMISSION_MODULES = [
  { id: "dashboard", label: "Dashboard", actions: ["view", "export"] },
  { id: "tenant-management", label: "Tenant Management", actions: ["view", "create", "update", "delete", "suspend", "activate", "approve", "reset", "manage", "configure"] },
  { id: "platform-users", label: "Platform Users", actions: ["view", "create", "update", "delete", "suspend", "activate", "assign"] },
  { id: "subscription-plans", label: "Subscription Plans", actions: ["view", "create", "update", "delete", "enable", "disable"] },
  { id: "subscriptions", label: "Subscriptions", actions: ["view", "create", "update", "suspend", "activate", "approve"] },
  { id: "payments", label: "Payments", actions: ["view", "export", "approve", "manage"] },
  { id: "invoices", label: "Invoices", actions: ["view", "create", "export", "approve"] },
  { id: "reports", label: "Reports", actions: ["view", "export", "configure"] },
  { id: "analytics", label: "Analytics", actions: ["view", "export", "configure"] },
  { id: "support-tickets", label: "Support Tickets", actions: ["view", "create", "update", "assign", "manage"] },
  { id: "notifications", label: "Notifications", actions: ["view", "create", "update", "configure"] },
  { id: "audit-logs", label: "Audit Logs", actions: ["view", "export"] },
  { id: "ai-management", label: "AI Management", actions: ["view", "configure", "manage", "enable", "disable"] },
  { id: "feature-flags", label: "Feature Flags", actions: ["view", "create", "update", "enable", "disable"] },
  { id: "security", label: "Security", actions: ["view", "configure", "manage"] },
  { id: "platform-settings", label: "Platform Settings", actions: ["view", "update", "configure"] },
  { id: "role-management", label: "Role Management", actions: ["view", "create", "update", "delete", "clone", "assign"] },
  { id: "permission-management", label: "Permission Management", actions: ["view", "configure", "manage"] },
  { id: "system-configuration", label: "System Configuration", actions: ["view", "update", "configure"] },
  { id: "api-keys", label: "API Keys", actions: ["view", "create", "delete", "reset"] },
  { id: "maintenance-mode", label: "Maintenance Mode", actions: ["view", "enable", "disable", "configure"] },
];

function fullPermissions(modules) {
  const perms = {};
  modules.forEach((m) => {
    perms[m.id] = [...m.actions];
  });
  return perms;
}

function readOnlyPermissions(modules) {
  const perms = {};
  modules.forEach((m) => {
    if (m.actions.includes("view")) perms[m.id] = ["view"];
  });
  return perms;
}

function instructorPermissions() {
  return {
    dashboard: ["view"],
    courses: ["view", "create", "edit", "publish", "archive"],
    "course-modules": ["view", "create", "edit", "publish"],
    lessons: ["view", "create", "edit", "publish"],
    assignments: ["view", "create", "edit", "assign", "approve"],
    quizzes: ["view", "create", "edit", "publish", "assign"],
    "mock-tests": ["view", "create", "edit", "publish"],
    "mock-interviews": ["view", "create", "edit", "manage"],
    "live-sessions": ["view", "create", "edit", "manage"],
    learners: ["view", "assign"],
    instructors: ["view"],
    mentorship: ["view", "assign", "claim", "close"],
    forum: ["view", "create", "edit", "moderate"],
    notifications: ["view", "create"],
    reports: ["view", "export"],
    analytics: ["view"],
  };
}

function learnerPermissions() {
  return {
    dashboard: ["view"],
    courses: ["view"],
    lessons: ["view"],
    assignments: ["view"],
    quizzes: ["view"],
    "mock-tests": ["view"],
    "mock-interviews": ["view"],
    "live-sessions": ["view"],
    certificates: ["view"],
    mentorship: ["view", "create"],
    community: ["view", "create"],
    forum: ["view", "create"],
    notifications: ["view"],
  };
}

function orgAdminPermissions() {
  return {
    ...readOnlyPermissions(TENANT_PERMISSION_MODULES),
    users: ["view", "create", "edit", "assign", "export", "manage"],
    roles: ["view", "create", "edit", "clone", "assign"],
    courses: ["view", "create", "edit", "delete", "publish", "archive", "assign"],
    "org-settings": ["view", "edit", "configure"],
    branding: ["view", "edit"],
    reports: ["view", "export"],
    analytics: ["view"],
    "audit-logs": ["view", "export"],
  };
}

/** Default tenant system roles seeded per organization. */
export const TENANT_ROLE_SEEDS = [
  {
    slug: "organization-owner",
    name: "Organization Owner",
    description: "Full organization ownership and control.",
    roleType: "system",
    protected: true,
    isOwnerRole: true,
    legacyRole: "tenant_admin",
    legacyApiRole: "TENANT_ADMIN",
    permissions: fullPermissions(TENANT_PERMISSION_MODULES),
  },
  {
    slug: "org-admin",
    name: "Organization Admin",
    description: "Manages users, roles, courses, and organization settings.",
    roleType: "system",
    protected: true,
    legacyRole: "org_admin",
    legacyApiRole: "ORG_ADMIN",
    permissions: orgAdminPermissions(),
  },
  {
    slug: "instructor",
    name: "Instructor",
    description: "Creates and delivers courses, assignments, and quizzes.",
    roleType: "system",
    protected: true,
    legacyRole: "instructor",
    legacyApiRole: "TUTOR",
    permissions: instructorPermissions(),
  },
  {
    slug: "learner",
    name: "Learner",
    description: "Enrolls in courses and tracks learning progress.",
    roleType: "system",
    protected: true,
    legacyRole: "student",
    legacyApiRole: "LEARNER",
    permissions: learnerPermissions(),
  },
  {
    slug: "teaching-assistant",
    name: "Teaching Assistant",
    description: "Supports instructors with content and student management.",
    roleType: "system",
    protected: true,
    legacyRole: "instructor",
    legacyApiRole: "TUTOR",
    permissions: {
      dashboard: ["view"],
      courses: ["view", "edit"],
      lessons: ["view", "create", "edit"],
      assignments: ["view", "edit", "assign"],
      quizzes: ["view", "edit"],
      learners: ["view", "assign"],
    },
  },
  {
    slug: "mentor",
    name: "Mentor",
    description: "Guides students through mentorship sessions.",
    roleType: "system",
    protected: true,
    legacyRole: "instructor",
    legacyApiRole: "TUTOR",
    permissions: {
      dashboard: ["view"],
      mentorship: ["view", "create", "edit", "assign", "claim", "close", "manage"],
      "mock-interviews": ["view", "create", "edit", "manage"],
      learners: ["view", "assign"],
      notifications: ["view", "create"],
    },
  },
  {
    slug: "support",
    name: "Support",
    description: "Handles user support and community moderation.",
    roleType: "system",
    protected: true,
    legacyRole: "student",
    legacyApiRole: "STUDENT",
    permissions: {
      dashboard: ["view"],
      users: ["view"],
      learners: ["view"],
      community: ["view", "moderate", "manage"],
      forum: ["view", "moderate", "approve"],
      notifications: ["view", "create"],
    },
  },
  {
    slug: "content-reviewer",
    name: "Content Reviewer",
    description: "Reviews and approves course content before publishing.",
    roleType: "system",
    protected: true,
    legacyRole: "student",
    legacyApiRole: "STUDENT",
    permissions: {
      dashboard: ["view"],
      courses: ["view", "approve", "archive"],
      lessons: ["view", "approve"],
      assignments: ["view", "approve"],
      quizzes: ["view", "approve"],
      "mock-tests": ["view", "approve"],
      certificates: ["view", "approve"],
    },
  },
];

/** Default platform (superadmin) system roles. */
export const PLATFORM_ROLE_SEEDS = [
  {
    slug: "super-admin",
    name: "Super Admin",
    description: "Full platform access",
    roleType: "system",
    protected: true,
    permissions: fullPermissions(PLATFORM_PERMISSION_MODULES),
  },
  {
    slug: "platform-admin",
    name: "Platform Admin",
    description: "Manage tenants and platform users",
    roleType: "system",
    protected: true,
    permissions: {
      ...readOnlyPermissions(PLATFORM_PERMISSION_MODULES),
      "tenant-management": ["view", "create", "update", "suspend", "activate", "manage"],
      "platform-users": ["view", "create", "update", "assign"],
    },
  },
  {
    slug: "finance-admin",
    name: "Finance Admin",
    description: "Billing and payments",
    roleType: "system",
    protected: true,
    permissions: {
      dashboard: ["view"],
      payments: ["view", "export", "approve"],
      invoices: ["view", "export"],
      subscriptions: ["view", "update"],
    },
  },
  {
    slug: "support-admin",
    name: "Support Admin",
    description: "Support tickets and notifications",
    roleType: "system",
    protected: true,
    permissions: {
      dashboard: ["view"],
      "support-tickets": ["view", "create", "update", "assign", "manage"],
      notifications: ["view", "create"],
    },
  },
  {
    slug: "security-admin",
    name: "Security Admin",
    description: "Security and audit",
    roleType: "system",
    protected: true,
    permissions: {
      security: ["view", "configure", "manage"],
      "audit-logs": ["view", "export"],
      "api-keys": ["view", "create", "delete"],
    },
  },
  {
    slug: "auditor",
    name: "Auditor",
    description: "Compliance read access",
    roleType: "system",
    protected: true,
    permissions: {
      ...readOnlyPermissions(PLATFORM_PERMISSION_MODULES),
      "audit-logs": ["view", "export"],
      reports: ["view", "export"],
    },
  },
  {
    slug: "read-only",
    name: "Read Only",
    description: "View-only platform access",
    roleType: "system",
    protected: true,
    permissions: readOnlyPermissions(PLATFORM_PERMISSION_MODULES),
  },
];

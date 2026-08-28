/** Full permission matrix: every role against every endpoint the tenant UI calls. */
process.env.NODE_ENV = "test";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryServer } from "mongodb-memory-server";

const { generateKeysIfMissing, resetKeyCache, signAccessToken } = await import("./utils/tokens.js");
resetKeyCache();
generateKeysIfMissing();

const { createApp } = await import("./app.js");
const Tenant = (await import("./models/Tenant.js")).default;
const User = (await import("./models/User.js")).default;
const Course = (await import("./models/Course.js")).default;
const Module = (await import("./models/Module.js")).default;
const Lesson = (await import("./models/Lesson.js")).default;
const SuperAdmin = (await import("./models/SuperAdmin.js")).default;
const { seedTenantRoles, getTenantRoleBySlug } = await import("./services/roleService.js");
const { seedDefaultPlans } = await import("./services/planService.js");

const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri(), { dbName: "matrix" });
const app = createApp();

const ca = await SuperAdmin.create({ email: "p@x.test", passwordHash: "x", status: "active" });
await seedDefaultPlans();
const plan = (await SuperAdmin.findById(ca._id)).plans.find((p) => p.name === "PREMIUM");
const tenant = await Tenant.create({ name: "T", subdomain: "t", status: "active", planId: plan._id });
await seedTenantRoles(tenant._id);

const SLUGS = ["learner", "instructor", "mentor", "content-reviewer", "teaching-assistant", "support", "org-admin", "organization-owner"];
const API_ROLE = {
  learner: "STUDENT", instructor: "TUTOR", mentor: "TUTOR", "content-reviewer": "TUTOR",
  "teaching-assistant": "TUTOR", support: "TUTOR", "org-admin": "ORG_ADMIN", "organization-owner": "TENANT_ADMIN",
};

const users = {};
for (const slug of SLUGS) {
  const role = await getTenantRoleBySlug(tenant._id, slug);
  users[slug] = await User.create({
    tenantId: tenant._id, email: `${slug}@x`, passwordHash: "x", roleId: role._id,
    status: "active", name: slug, isTenantAdmin: slug === "organization-owner",
  });
}

const H = (slug) => ({
  Authorization: `Bearer ${signAccessToken({
    sub: String(users[slug]._id), tenant_id: String(tenant._id), role: API_ROLE[slug], type: "tenant_user",
  })}`,
});

// A course owned by the instructor, with content, for the id-bearing routes.
const course = await Course.create({ tenantId: tenant._id, instructorId: users.instructor._id, title: "C" });
const mod = await Module.create({ courseId: course._id, tenantId: tenant._id, title: "M", order: 0 });
const lesson = await Lesson.create({ moduleId: mod._id, courseId: course._id, tenantId: tenant._id, title: "L", order: 0, type: "TEXT" });
const CID = String(course._id);

/** Endpoints the tenant UI actually calls, grouped by the page that calls them. */
const ENDPOINTS = [
  ["GET", "/api/auth/me", "session"],
  ["GET", "/api/notifications", "header bell"],
  ["GET", "/api/notifications/unread-count", "header bell"],

  ["GET", "/api/courses", "Courses"],
  ["GET", `/api/courses/${CID}`, "CourseDetail"],
  ["GET", "/api/enrollments/my", "MyLearning"],
  ["GET", "/api/progress/my", "Dashboard"],

  ["GET", "/api/live-sessions", "LiveSessions"],
  ["GET", `/api/live-sessions/course/${CID}`, "LiveSessions"],

  ["GET", "/api/mock-tests", "MockTests"],
  ["GET", `/api/mock-tests/course/${CID}`, "MockTests"],

  ["GET", "/api/mentorship/mentors", "Mentorship"],
  ["GET", "/api/mentorship/profile/me", "MentorDashboard"],
  ["GET", "/api/mentorship-tickets/mine", "Mentorship"],
  ["GET", "/api/mentorship-tickets/queue", "MentorDashboard"],
  ["GET", "/api/mentorship-tickets/dashboard/mentor", "MentorDashboard"],
  ["GET", "/api/mentorship-tickets/dashboard/admin", "admin MentorshipQueue"],
  ["GET", "/api/mentorship-tickets", "admin MentorshipQueue"],

  ["GET", "/api/session-slots", "MockInterviews"],
  ["GET", "/api/session-slots/my", "MockInterviews"],
  ["GET", "/api/session-slots/all", "admin"],

  ["GET", "/api/forum/questions", "Forum"],

  ["GET", "/api/courses/reviewers", "review panel"],
  ["GET", "/api/courses/review-queue", "ReviewQueue"],
  ["GET", `/api/courses/${CID}/review`, "review panel"],

  ["GET", "/api/users/students", "teach"],
  ["GET", `/api/enrollments/course/${CID}`, "CourseStudents"],
  ["GET", `/api/courses/${CID}/enrollable-users`, "CourseStudents"],
  ["GET", `/api/quizzes/lesson/${lesson._id}`, "Learn"],
  ["GET", `/api/progress/course/${CID}`, "Learn"],

  ["PATCH", "/api/users/me/profile", "Profile", { phone: "1" }],
  ["PATCH", `/api/courses/${CID}`, "CourseEditor", { title: "C2" }],
  ["PATCH", `/api/courses/modules/${mod._id}`, "CourseEditor", { title: "M2" }],
  ["PATCH", `/api/courses/lessons/${lesson._id}`, "CourseEditor", { title: "L2" }],

  ["GET", "/api/roles", "admin Roles"],
  ["GET", "/api/master-data/categories", "admin MasterData"],
];

const send = (method, path, slug, body) => {
  const r = request(app)[method.toLowerCase()](path).set(H(slug));
  return body ? r.send(body) : r;
};

const pad = (s, n) => String(s).padEnd(n);
console.log("\n" + pad("ENDPOINT", 52) + SLUGS.map((s) => pad(s.slice(0, 8), 9)).join(""));
console.log("-".repeat(52 + SLUGS.length * 9));

const problems = [];
for (const [method, path, page, body] of ENDPOINTS) {
  const cells = [];
  for (const slug of SLUGS) {
    const res = await send(method, path, slug, body);
    const code = res.status;
    cells.push(pad(code === 200 || code === 201 ? "ok" : code, 9));
    if (code >= 500) problems.push(`${method} ${path} as ${slug} -> ${code} ${JSON.stringify(res.body).slice(0, 160)}`);
  }
  console.log(pad(`${method} ${path.replace(CID, ":id").replace(String(mod._id), ":mid").replace(String(lesson._id), ":lid")}`, 52) + cells.join("") + "  " + page);
}

if (problems.length) {
  console.log("\n=== 5xx ===");
  problems.forEach((p) => console.log(p));
}

await mongoose.disconnect();
await mongo.stop();

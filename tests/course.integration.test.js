import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryServer } from "mongodb-memory-server";

import { createApp } from "../app.js";
import Tenant from "../models/Tenant.js";
import User from "../models/User.js";
import Course from "../models/Course.js";
import Module from "../models/Module.js";
import Lesson from "../models/Lesson.js";
import Enrollment from "../models/Enrollment.js";
import SuperAdmin from "../models/SuperAdmin.js";
import { signAccessToken } from "../utils/tokens.js";
import { seedTenantRoles, getTenantRoleBySlug } from "../services/roleService.js";
import { seedDefaultPlans } from "../services/planService.js";

let mongo;
let app;
let fx;

/** Two tenants, two instructors in tenant A, one admin, one student — enough to prove isolation. */
async function seedFixtures() {
  // Plans live embedded on the primary super admin (Tenant.planId -> SuperAdmin.plans[]._id),
  // not in a standalone collection — checkPlanLimits resolves them from there.
  const catalogAdmin = await SuperAdmin.create({
    email: "platform@skillara.test",
    passwordHash: "x",
    status: "active",
  });
  await seedDefaultPlans();
  const plan = (await SuperAdmin.findById(catalogAdmin._id)).plans.find(
    (p) => p.name === "PREMIUM"
  );

  const tenantA = await Tenant.create({
    name: "Tenant A",
    subdomain: "tenant-a",
    status: "active",
    planId: plan._id,
  });
  const tenantB = await Tenant.create({
    name: "Tenant B",
    subdomain: "tenant-b",
    status: "active",
    planId: plan._id,
  });

  await seedTenantRoles(tenantA._id);
  await seedTenantRoles(tenantB._id);

  const roles = {
    instructorA: await getTenantRoleBySlug(tenantA._id, "instructor"),
    studentA: await getTenantRoleBySlug(tenantA._id, "learner"),
    ownerA: await getTenantRoleBySlug(tenantA._id, "organization-owner"),
    reviewerA: await getTenantRoleBySlug(tenantA._id, "content-reviewer"),
    instructorB: await getTenantRoleBySlug(tenantB._id, "instructor"),
  };

  const make = async (tenantId, email, roleId, extra = {}) =>
    User.create({ tenantId, email, passwordHash: "x", roleId, status: "active", ...extra });

  const tutor1 = await make(tenantA._id, "tutor1@a.com", roles.instructorA._id, { name: "Tutor One" });
  const tutor2 = await make(tenantA._id, "tutor2@a.com", roles.instructorA._id, { name: "Tutor Two" });
  const admin = await make(tenantA._id, "admin@a.com", roles.ownerA._id, { isTenantAdmin: true });
  const student = await make(tenantA._id, "student@a.com", roles.studentA._id);
  const reviewer = await make(tenantA._id, "reviewer@a.com", roles.reviewerA._id, {
    name: "Rev Reviewer",
  });
  const tutorB = await make(tenantB._id, "tutor@b.com", roles.instructorB._id);

  return { tenantA, tenantB, tutor1, tutor2, admin, student, reviewer, tutorB };
}

function tokenFor(user, role) {
  return signAccessToken({
    sub: String(user._id),
    tenant_id: String(user.tenantId),
    role,
    type: "tenant_user",
  });
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri(), { dbName: "course-test" });
  app = createApp();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  await Promise.all(
    [Tenant, User, Course, Module, Lesson, Enrollment, SuperAdmin].map((m) => m.deleteMany({}))
  );
  fx = await seedFixtures();
});

describe("course authoring", () => {
  test("instructor creates a course and is recorded as the owner", async () => {
    const token = tokenFor(fx.tutor1, "TUTOR");

    const res = await request(app)
      .post("/api/courses")
      .set(auth(token))
      .send({ title: "Node Basics", category: "Backend", level: "BEGINNER", price: 499 });

    expect(res.status).toBe(201);
    expect(res.body.data.title).toBe("Node Basics");
    expect(res.body.data.status).toBe("DRAFT");

    const saved = await Course.findById(res.body.data.id);
    // Regression: the controller used to read req.user._id, which is undefined for
    // token-shaped actors, so instructorId was never persisted.
    expect(String(saved.instructorId)).toBe(String(fx.tutor1._id));
    expect(String(saved.tenantId)).toBe(String(fx.tenantA._id));
  });

  test("an instructor cannot edit another instructor's course", async () => {
    const course = await Course.create({
      tenantId: fx.tenantA._id,
      instructorId: fx.tutor1._id,
      title: "Owned by tutor1",
    });

    const res = await request(app)
      .patch(`/api/courses/${course._id}`)
      .set(auth(tokenFor(fx.tutor2, "TUTOR")))
      .send({ title: "Hijacked" });

    expect(res.status).toBe(404);
    const unchanged = await Course.findById(course._id);
    expect(unchanged.title).toBe("Owned by tutor1");
  });

  test("an instructor can edit their own course", async () => {
    const course = await Course.create({
      tenantId: fx.tenantA._id,
      instructorId: fx.tutor1._id,
      title: "Mine",
    });

    const res = await request(app)
      .patch(`/api/courses/${course._id}`)
      .set(auth(tokenFor(fx.tutor1, "TUTOR")))
      .send({ title: "Mine, renamed" });

    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe("Mine, renamed");
  });

  test("a course in another tenant is not reachable", async () => {
    const course = await Course.create({
      tenantId: fx.tenantB._id,
      instructorId: fx.tutorB._id,
      title: "Tenant B course",
      status: "PUBLISHED",
    });

    const res = await request(app)
      .get(`/api/courses/${course._id}`)
      .set(auth(tokenFor(fx.admin, "TENANT_ADMIN")));

    expect(res.status).toBe(404);
  });

  test("students cannot create courses", async () => {
    const res = await request(app)
      .post("/api/courses")
      .set(auth(tokenFor(fx.student, "STUDENT")))
      .send({ title: "Nope" });

    expect(res.status).toBe(403);
  });
});

describe("publishing", () => {
  async function courseWithLesson(instructor) {
    const course = await Course.create({
      tenantId: fx.tenantA._id,
      instructorId: instructor._id,
      title: "Publishable",
    });
    const module = await Module.create({
      courseId: course._id,
      tenantId: fx.tenantA._id,
      title: "M1",
      order: 0,
    });
    await Lesson.create({
      moduleId: module._id,
      courseId: course._id,
      tenantId: fx.tenantA._id,
      title: "L1",
      order: 0,
      type: "TEXT",
    });
    return course;
  }

  /** Publishing now requires a content-review approval; give the course one directly. */
  async function approved(course) {
    await Course.updateOne(
      { _id: course._id },
      { $set: { "review.status": "APPROVED", "review.reviewerId": fx.reviewer._id } }
    );
    return course;
  }

  test("an empty course cannot be published", async () => {
    const course = await Course.create({
      tenantId: fx.tenantA._id,
      instructorId: fx.tutor1._id,
      title: "Empty",
    });

    const res = await request(app)
      .post(`/api/courses/${course._id}/publish`)
      .set(auth(tokenFor(fx.tutor1, "TUTOR")));

    expect(res.status).toBe(422);
  });

  test("a course that has not been through review cannot be published", async () => {
    const course = await courseWithLesson(fx.tutor1);

    const res = await request(app)
      .post(`/api/courses/${course._id}/publish`)
      .set(auth(tokenFor(fx.tutor1, "TUTOR")));

    expect(res.status).toBe(422);
    expect((await Course.findById(course._id)).status).toBe("DRAFT");
  });

  test("an approved course publishes and sets publishedAt", async () => {
    const course = await approved(await courseWithLesson(fx.tutor1));

    const res = await request(app)
      .post(`/api/courses/${course._id}/publish`)
      .set(auth(tokenFor(fx.tutor1, "TUTOR")));

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("PUBLISHED");
    expect(res.body.data.publishedAt).toBeTruthy();
  });

  test("PATCH cannot smuggle status=PUBLISHED past the content check", async () => {
    const course = await Course.create({
      tenantId: fx.tenantA._id,
      instructorId: fx.tutor1._id,
      title: "Empty",
    });

    const res = await request(app)
      .patch(`/api/courses/${course._id}`)
      .set(auth(tokenFor(fx.tutor1, "TUTOR")))
      .send({ status: "PUBLISHED" });

    expect(res.status).toBe(400);
    expect((await Course.findById(course._id)).status).toBe("DRAFT");
  });

  test("tenant admin can unpublish another instructor's course", async () => {
    const course = await courseWithLesson(fx.tutor1);
    await Course.updateOne({ _id: course._id }, { $set: { status: "PUBLISHED" } });

    const res = await request(app)
      .post(`/api/courses/${course._id}/unpublish`)
      .set(auth(tokenFor(fx.admin, "TENANT_ADMIN")));

    expect(res.status).toBe(200);
    expect((await Course.findById(course._id)).status).toBe("DRAFT");
  });

  test("tenant admin blocks a course; the instructor can no longer publish it", async () => {
    const course = await approved(await courseWithLesson(fx.tutor1));

    const blocked = await request(app)
      .post(`/api/courses/${course._id}/block`)
      .set(auth(tokenFor(fx.admin, "TENANT_ADMIN")))
      .send({ reason: "Copyright complaint" });
    expect(blocked.status).toBe(200);

    const publish = await request(app)
      .post(`/api/courses/${course._id}/publish`)
      .set(auth(tokenFor(fx.tutor1, "TUTOR")));
    expect(publish.status).toBe(403);
  });

  test("an instructor cannot block a course", async () => {
    const course = await courseWithLesson(fx.tutor2);

    const res = await request(app)
      .post(`/api/courses/${course._id}/block`)
      .set(auth(tokenFor(fx.tutor1, "TUTOR")))
      .send({ reason: "I do not like it" });

    expect(res.status).toBe(403);
  });
});

describe("catalog visibility", () => {
  beforeEach(async () => {
    await Course.create([
      {
        tenantId: fx.tenantA._id,
        instructorId: fx.tutor1._id,
        title: "Published A",
        status: "PUBLISHED",
      },
      { tenantId: fx.tenantA._id, instructorId: fx.tutor1._id, title: "Draft A", status: "DRAFT" },
      {
        tenantId: fx.tenantA._id,
        instructorId: fx.tutor1._id,
        title: "Blocked A",
        status: "PUBLISHED",
        moderation: { isBlocked: true, reason: "spam" },
      },
    ]);
  });

  test("a student sees only live courses", async () => {
    const res = await request(app)
      .get("/api/courses")
      .set(auth(tokenFor(fx.student, "STUDENT")));

    expect(res.status).toBe(200);
    const titles = res.body.data.map((c) => c.title);
    expect(titles).toEqual(["Published A"]);
  });

  test("a tenant admin sees drafts and blocked courses too", async () => {
    const res = await request(app)
      .get("/api/courses")
      .set(auth(tokenFor(fx.admin, "TENANT_ADMIN")));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
  });

  test("an instructor sees their own drafts but not another instructor's", async () => {
    await Course.create({
      tenantId: fx.tenantA._id,
      instructorId: fx.tutor2._id,
      title: "Tutor2 draft",
      status: "DRAFT",
    });

    const res = await request(app)
      .get("/api/courses")
      .set(auth(tokenFor(fx.tutor1, "TUTOR")));

    const titles = res.body.data.map((c) => c.title);
    expect(titles).toContain("Draft A");
    expect(titles).toContain("Published A");
    expect(titles).not.toContain("Tutor2 draft");
  });

  test("results are paginated", async () => {
    const res = await request(app)
      .get("/api/courses?limit=1")
      .set(auth(tokenFor(fx.admin, "TENANT_ADMIN")));

    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination.totalRecords).toBe(3);
    expect(res.body.pagination.totalPages).toBe(3);
  });
});

describe("modules and lessons", () => {
  let course;
  let token;

  beforeEach(async () => {
    course = await Course.create({
      tenantId: fx.tenantA._id,
      instructorId: fx.tutor1._id,
      title: "Structured",
    });
    token = tokenFor(fx.tutor1, "TUTOR");
  });

  test("modules and lessons are created with tenant and course denormalized", async () => {
    const moduleRes = await request(app)
      .post(`/api/courses/${course._id}/modules`)
      .set(auth(token))
      .send({ title: "Module 1" });
    expect(moduleRes.status).toBe(201);

    const moduleId = moduleRes.body.data.id;
    const lessonRes = await request(app)
      .post(`/api/courses/modules/${moduleId}/lessons`)
      .set(auth(token))
      .send({ title: "Lesson 1", type: "TEXT", duration: 12 });
    expect(lessonRes.status).toBe(201);

    const lesson = await Lesson.findById(lessonRes.body.data.id);
    expect(String(lesson.tenantId)).toBe(String(fx.tenantA._id));
    expect(String(lesson.courseId)).toBe(String(course._id));

    // Course stats are recomputed on lesson changes.
    const refreshed = await Course.findById(course._id);
    expect(refreshed.stats.lessonCount).toBe(1);
    expect(refreshed.stats.durationMinutes).toBe(12);
  });

  test("another instructor cannot add a module to someone else's course", async () => {
    const res = await request(app)
      .post(`/api/courses/${course._id}/modules`)
      .set(auth(tokenFor(fx.tutor2, "TUTOR")))
      .send({ title: "Sneaky" });

    expect(res.status).toBe(404);
  });

  test("reorder rejects a partial module list", async () => {
    const m1 = await Module.create({ courseId: course._id, tenantId: fx.tenantA._id, title: "A", order: 0 });
    await Module.create({ courseId: course._id, tenantId: fx.tenantA._id, title: "B", order: 1 });

    const res = await request(app)
      .put(`/api/courses/${course._id}/modules/reorder`)
      .set(auth(token))
      .send({ moduleIds: [String(m1._id)] });

    expect(res.status).toBe(400);
  });

  test("reorder applies the new order", async () => {
    const m1 = await Module.create({ courseId: course._id, tenantId: fx.tenantA._id, title: "A", order: 0 });
    const m2 = await Module.create({ courseId: course._id, tenantId: fx.tenantA._id, title: "B", order: 1 });

    const res = await request(app)
      .put(`/api/courses/${course._id}/modules/reorder`)
      .set(auth(token))
      .send({ moduleIds: [String(m2._id), String(m1._id)] });

    expect(res.status).toBe(200);
    expect((await Module.findById(m2._id)).order).toBe(0);
    expect((await Module.findById(m1._id)).order).toBe(1);
  });
});

describe("lesson content gating", () => {
  let course;
  let lockedLesson;
  let previewLesson;

  beforeEach(async () => {
    course = await Course.create({
      tenantId: fx.tenantA._id,
      instructorId: fx.tutor1._id,
      title: "Gated",
      status: "PUBLISHED",
    });
    const module = await Module.create({
      courseId: course._id,
      tenantId: fx.tenantA._id,
      title: "M",
      order: 0,
    });
    lockedLesson = await Lesson.create({
      moduleId: module._id,
      courseId: course._id,
      tenantId: fx.tenantA._id,
      title: "Paid lesson",
      order: 0,
      type: "TEXT",
      content: "secret body",
    });
    previewLesson = await Lesson.create({
      moduleId: module._id,
      courseId: course._id,
      tenantId: fx.tenantA._id,
      title: "Free preview",
      order: 1,
      type: "TEXT",
      content: "free body",
      isPreview: true,
    });
  });

  test("an unenrolled student gets locked lessons with content stripped", async () => {
    const res = await request(app)
      .get(`/api/courses/${course._id}`)
      .set(auth(tokenFor(fx.student, "STUDENT")));

    expect(res.status).toBe(200);
    const lessons = res.body.data.modules[0].lessons;
    const locked = lessons.find((l) => l.id === String(lockedLesson._id));
    const preview = lessons.find((l) => l.id === String(previewLesson._id));

    expect(locked.locked).toBe(true);
    expect(locked.content).toBe("");
    expect(preview.locked).toBe(false);
    expect(preview.content).toBe("free body");
  });

  test("an enrolled student sees full lesson content", async () => {
    await Enrollment.create({
      userId: fx.student._id,
      courseId: course._id,
      tenantId: fx.tenantA._id,
      status: "ACTIVE",
    });

    const res = await request(app)
      .get(`/api/courses/${course._id}`)
      .set(auth(tokenFor(fx.student, "STUDENT")));

    const lessons = res.body.data.modules[0].lessons;
    expect(lessons.every((l) => l.locked === false)).toBe(true);
    expect(res.body.data.hasAccess).toBe(true);
  });

  test("playback is refused without an enrollment", async () => {
    process.env.B2_ENDPOINT = "s3.us-east-005.backblazeb2.com";
    process.env.B2_BUCKET = "test-bucket";
    process.env.B2_KEY_ID = "test-key-id";
    process.env.B2_APP_KEY = "test-app-key";

    const res = await request(app)
      .get(`/api/courses/lessons/${lockedLesson._id}/play`)
      .set(auth(tokenFor(fx.student, "STUDENT")));

    expect(res.status).toBe(403);
    expect(res.body.message.errorKey).toBe("ENROLLMENT_REQUIRED");
  });
});

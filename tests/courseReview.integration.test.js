/**
 * Content-review workflow: an instructor cannot publish until a content reviewer has
 * approved the course, and each hand-off notifies the other side.
 *
 * Also covers the authorization change these routes depend on — every tenant route is gated
 * by the permission matrix, so the assertions here are about permissions, never role names.
 */
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryServer } from "mongodb-memory-server";

import { createApp } from "../app.js";
import Tenant from "../models/Tenant.js";
import User from "../models/User.js";
import Course from "../models/Course.js";
import Module from "../models/Module.js";
import Lesson from "../models/Lesson.js";
import Notification from "../models/Notification.js";
import SuperAdmin from "../models/SuperAdmin.js";
import { signAccessToken } from "../utils/tokens.js";
import { seedTenantRoles, getTenantRoleBySlug } from "../services/roleService.js";
import { seedDefaultPlans } from "../services/planService.js";

let mongo;
let app;
let fx;

async function seedFixtures() {
  const catalogAdmin = await SuperAdmin.create({
    email: "platform@skillara.test",
    passwordHash: "x",
    status: "active",
  });
  await seedDefaultPlans();
  const plan = (await SuperAdmin.findById(catalogAdmin._id)).plans.find(
    (p) => p.name === "PREMIUM"
  );

  const tenant = await Tenant.create({
    name: "Review Co",
    subdomain: "review-co",
    status: "active",
    planId: plan._id,
  });
  await seedTenantRoles(tenant._id);

  const roles = {
    instructor: await getTenantRoleBySlug(tenant._id, "instructor"),
    reviewer: await getTenantRoleBySlug(tenant._id, "content-reviewer"),
    learner: await getTenantRoleBySlug(tenant._id, "learner"),
    owner: await getTenantRoleBySlug(tenant._id, "organization-owner"),
  };

  const make = (email, roleId, extra = {}) =>
    User.create({ tenantId: tenant._id, email, passwordHash: "x", roleId, status: "active", ...extra });

  return {
    tenant,
    roles,
    instructor: await make("tutor@review.co", roles.instructor._id, { name: "Ins Tructor" }),
    reviewer: await make("reviewer@review.co", roles.reviewer._id, { name: "Rev Iewer" }),
    learner: await make("learner@review.co", roles.learner._id, { name: "Lea Rner" }),
    owner: await make("owner@review.co", roles.owner._id, { name: "Ow Ner", isTenantAdmin: true }),
  };
}

/**
 * Tokens carry only the legacy bucket, never a permission list — proving authorization is
 * resolved server-side from the user's role document on every request.
 */
function tokenFor(user, role) {
  return signAccessToken({
    sub: String(user._id),
    tenant_id: String(user.tenantId),
    role,
    type: "tenant_user",
  });
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const asInstructor = () => auth(tokenFor(fx.instructor, "TUTOR"));
const asReviewer = () => auth(tokenFor(fx.reviewer, "TUTOR"));
const asLearner = () => auth(tokenFor(fx.learner, "STUDENT"));

async function courseWithLesson(title = "Publishable") {
  const course = await Course.create({
    tenantId: fx.tenant._id,
    instructorId: fx.instructor._id,
    title,
  });
  const mod = await Module.create({
    courseId: course._id,
    tenantId: fx.tenant._id,
    title: "M1",
    order: 0,
  });
  await Lesson.create({
    moduleId: mod._id,
    courseId: course._id,
    tenantId: fx.tenant._id,
    title: "L1",
    order: 0,
    type: "TEXT",
  });
  return course;
}

const submit = (course, body) =>
  request(app).post(`/api/courses/${course._id}/submit-review`).set(asInstructor()).send(body);

const publish = (course) =>
  request(app).post(`/api/courses/${course._id}/publish`).set(asInstructor());

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri(), { dbName: "course-review-test" });
  app = createApp();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  await Promise.all(
    [Tenant, User, Course, Module, Lesson, Notification, SuperAdmin].map((m) => m.deleteMany({}))
  );
  fx = await seedFixtures();
});

describe("permission-based authorization", () => {
  test("a learner cannot create a course", async () => {
    const res = await request(app)
      .post("/api/courses")
      .set(asLearner())
      .send({ title: "Nope" });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("PERMISSION_DENIED");
    expect(res.body.moduleId).toBe("courses");
    expect(res.body.action).toBe("create");
  });

  test("a content reviewer cannot publish, even though they can approve", async () => {
    const course = await courseWithLesson();
    await Course.updateOne({ _id: course._id }, { $set: { "review.status": "APPROVED" } });

    const res = await request(app)
      .post(`/api/courses/${course._id}/publish`)
      .set(asReviewer());

    expect(res.status).toBe(403);
    expect(res.body.action).toBe("publish");
  });

  test("a learner cannot decide a review", async () => {
    const course = await courseWithLesson();
    const res = await request(app)
      .post(`/api/courses/${course._id}/review/approve`)
      .set(asLearner())
      .send({});

    expect(res.status).toBe(403);
  });
});

describe("content review workflow", () => {
  test("an instructor cannot publish a course that has not been reviewed", async () => {
    const course = await courseWithLesson();

    const res = await publish(course);

    expect(res.status).toBe(422);
    expect((await Course.findById(course._id)).status).toBe("DRAFT");
  });

  test("the reviewer list is derived from courses:approve, not from a role name", async () => {
    const res = await request(app).get("/api/courses/reviewers").set(asInstructor());

    expect(res.status).toBe(200);
    const ids = res.body.data.reviewers.map((r) => r.id);
    expect(ids).toContain(String(fx.reviewer._id));
    expect(ids).not.toContain(String(fx.learner._id));
  });

  test("submitting assigns the reviewer and notifies them", async () => {
    const course = await courseWithLesson();

    const res = await submit(course, {
      reviewerId: String(fx.reviewer._id),
      note: "Ready for review",
    });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("PENDING");
    expect(res.body.data.reviewerId).toBe(String(fx.reviewer._id));

    const inbox = await request(app).get("/api/notifications").set(asReviewer());
    expect(inbox.status).toBe(200);
    expect(inbox.body.data.unreadCount).toBe(1);
    expect(inbox.body.data.notifications[0].type).toBe("course.review.assigned");
    expect(inbox.body.data.notifications[0].courseId).toBe(String(course._id));
  });

  test("a course cannot be submitted to someone who cannot approve", async () => {
    const course = await courseWithLesson();

    const res = await submit(course, { reviewerId: String(fx.learner._id) });

    expect(res.status).toBe(400);
  });

  test("the assigned reviewer can open the draft they were asked to review", async () => {
    const course = await courseWithLesson();
    await submit(course, { reviewerId: String(fx.reviewer._id) });

    const res = await request(app).get(`/api/courses/${course._id}`).set(asReviewer());

    expect(res.status).toBe(200);
    expect(res.body.data.review.status).toBe("PENDING");
  });

  test("an unrelated learner still cannot open the draft", async () => {
    const course = await courseWithLesson();
    await submit(course, { reviewerId: String(fx.reviewer._id) });

    const res = await request(app).get(`/api/courses/${course._id}`).set(asLearner());

    expect(res.status).toBe(404);
  });

  test("requesting changes sends the course back and notifies the instructor", async () => {
    const course = await courseWithLesson();
    await submit(course, { reviewerId: String(fx.reviewer._id) });

    const res = await request(app)
      .post(`/api/courses/${course._id}/review/request-changes`)
      .set(asReviewer())
      .send({ note: "Section 3 is plagiarised from another course." });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("CHANGES_REQUESTED");
    expect(res.body.data.note).toMatch(/plagiarised/);

    const inbox = await request(app).get("/api/notifications").set(asInstructor());
    expect(inbox.body.data.notifications[0].type).toBe("course.review.changes_requested");
    expect(inbox.body.data.notifications[0].message).toMatch(/plagiarised/);

    // Still not publishable.
    expect((await publish(course)).status).toBe(422);
  });

  test("changes requested without an explanation is rejected", async () => {
    const course = await courseWithLesson();
    await submit(course, { reviewerId: String(fx.reviewer._id) });

    const res = await request(app)
      .post(`/api/courses/${course._id}/review/request-changes`)
      .set(asReviewer())
      .send({});

    expect(res.status).toBe(400);
  });

  test("approval unblocks publishing and notifies the instructor", async () => {
    const course = await courseWithLesson();
    await submit(course, { reviewerId: String(fx.reviewer._id) });

    const approve = await request(app)
      .post(`/api/courses/${course._id}/review/approve`)
      .set(asReviewer())
      .send({ note: "Looks original." });

    expect(approve.status).toBe(200);
    expect(approve.body.data.status).toBe("APPROVED");
    expect(approve.body.data.canPublish).toBe(true);

    const inbox = await request(app).get("/api/notifications").set(asInstructor());
    expect(inbox.body.data.notifications[0].type).toBe("course.review.approved");

    const published = await publish(course);
    expect(published.status).toBe(200);
    expect(published.body.data.status).toBe("PUBLISHED");
  });

  test("the full loop: submit, changes, resubmit, approve, publish", async () => {
    const course = await courseWithLesson();

    await submit(course, { reviewerId: String(fx.reviewer._id) });
    await request(app)
      .post(`/api/courses/${course._id}/review/request-changes`)
      .set(asReviewer())
      .send({ note: "Cite your sources." });

    const resubmit = await submit(course, {
      reviewerId: String(fx.reviewer._id),
      note: "Sources cited.",
    });
    expect(resubmit.status).toBe(200);
    expect(resubmit.body.data.status).toBe("PENDING");

    await request(app)
      .post(`/api/courses/${course._id}/review/approve`)
      .set(asReviewer())
      .send({});

    expect((await publish(course)).status).toBe(200);

    const review = await request(app).get(`/api/courses/${course._id}/review`).set(asInstructor());
    expect(review.body.data.history.map((h) => h.action)).toEqual([
      "submitted",
      "changes_requested",
      "submitted",
      "approved",
    ]);
  });

  test("a pending course cannot be resubmitted", async () => {
    const course = await courseWithLesson();
    await submit(course, { reviewerId: String(fx.reviewer._id) });

    const res = await submit(course, { reviewerId: String(fx.reviewer._id) });

    expect(res.status).toBe(409);
  });

  test("unpublishing resets the review so the next publish needs a fresh approval", async () => {
    const course = await courseWithLesson();
    await submit(course, { reviewerId: String(fx.reviewer._id) });
    await request(app)
      .post(`/api/courses/${course._id}/review/approve`)
      .set(asReviewer())
      .send({});
    await publish(course);

    const unpublished = await request(app)
      .post(`/api/courses/${course._id}/unpublish`)
      .set(asInstructor());
    expect(unpublished.status).toBe(200);

    const after = await Course.findById(course._id);
    expect(after.review.status).toBe("NOT_SUBMITTED");
    expect((await publish(course)).status).toBe(422);
  });

  test("the review queue shows only the courses assigned to this reviewer", async () => {
    const mine = await courseWithLesson("Assigned to me");
    const other = await courseWithLesson("Not submitted");
    await submit(mine, { reviewerId: String(fx.reviewer._id) });

    const res = await request(app).get("/api/courses/review-queue").set(asReviewer());

    expect(res.status).toBe(200);
    const titles = res.body.data.courses.map((c) => c.title);
    expect(titles).toEqual(["Assigned to me"]);
    expect(titles).not.toContain(other.title);
  });
});

describe("notifications", () => {
  test("a notification can be marked read and drops out of the unread count", async () => {
    const course = await courseWithLesson();
    await submit(course, { reviewerId: String(fx.reviewer._id) });

    const inbox = await request(app).get("/api/notifications").set(asReviewer());
    const id = inbox.body.data.notifications[0].id;

    const read = await request(app).patch(`/api/notifications/${id}/read`).set(asReviewer());
    expect(read.status).toBe(200);
    expect(read.body.data.isRead).toBe(true);

    const count = await request(app).get("/api/notifications/unread-count").set(asReviewer());
    expect(count.body.data.unreadCount).toBe(0);
  });

  test("one user cannot read another user's notification", async () => {
    const course = await courseWithLesson();
    await submit(course, { reviewerId: String(fx.reviewer._id) });

    const inbox = await request(app).get("/api/notifications").set(asReviewer());
    const id = inbox.body.data.notifications[0].id;

    const res = await request(app).patch(`/api/notifications/${id}/read`).set(asLearner());

    expect(res.status).toBe(404);
  });

  test("the actor is never notified about their own action", async () => {
    const course = await courseWithLesson();
    await submit(course, { reviewerId: String(fx.reviewer._id) });

    const own = await request(app).get("/api/notifications").set(asInstructor());
    expect(own.body.data.unreadCount).toBe(0);
  });
});

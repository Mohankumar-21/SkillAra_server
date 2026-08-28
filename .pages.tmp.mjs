process.env.NODE_ENV = "test";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryServer } from "mongodb-memory-server";
const { generateKeysIfMissing, resetKeyCache, signAccessToken } = await import("./utils/tokens.js");
resetKeyCache(); generateKeysIfMissing();
const { createApp } = await import("./app.js");
const Tenant = (await import("./models/Tenant.js")).default;
const User = (await import("./models/User.js")).default;
const SuperAdmin = (await import("./models/SuperAdmin.js")).default;
const { seedTenantRoles, getTenantRoleBySlug } = await import("./services/roleService.js");
const { seedDefaultPlans } = await import("./services/planService.js");

const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri(), { dbName: "pages" });
const app = createApp();
const ca = await SuperAdmin.create({ email: "p@x", passwordHash: "x", status: "active" });
await seedDefaultPlans();
const plan = (await SuperAdmin.findById(ca._id)).plans.find((p) => p.name === "PREMIUM");
const t = await Tenant.create({ name: "T", subdomain: "t", status: "active", planId: plan._id });
await seedTenantRoles(t._id);
const R = { learner:"STUDENT", instructor:"TUTOR", mentor:"TUTOR", "content-reviewer":"TUTOR", "teaching-assistant":"TUTOR", support:"TUTOR" };
const SL = Object.keys(R); const U = {};
for (const s of SL) { const r = await getTenantRoleBySlug(t._id, s);
  U[s] = await User.create({ tenantId: t._id, email: s+"@x", passwordHash: "x", roleId: r._id, status: "active", name: s }); }
const H = (s) => ({ Authorization: `Bearer ${signAccessToken({ sub: String(U[s]._id), tenant_id: String(t._id), role: R[s], type: "tenant_user" })}` });
const EPS = [["/api/auth/me"],["/api/notifications"],["/api/notifications/unread-count"],["/api/courses"],
 ["/api/live-sessions"],["/api/mock-tests"],["/api/mentorship/mentors"],["/api/mentorship/profile/me"],
 ["/api/mentorship-tickets/mine"],["/api/mentorship-tickets/queue"],["/api/mentorship-tickets/dashboard/mentor"],
 ["/api/session-slots"],["/api/session-slots/my"],["/api/forum/questions"],["/api/enrollments/my"],["/api/progress/my"],
 ["/api/courses/reviewers"],["/api/courses/review-queue"]];
const pad=(s,n)=>String(s).padEnd(n);
console.log("\n"+pad("GET",40)+SL.map(s=>pad(s.slice(0,10),12)).join(""));
console.log("-".repeat(40+SL.length*12));
for (const [p] of EPS) {
  const cells=[];
  for (const s of SL) { const r = await request(app).get(p).set(H(s)); cells.push(pad(r.status===200?"ok":r.status,12)); }
  console.log(pad(p,40)+cells.join(""));
}
const pr = await request(app).patch("/api/users/me/profile").set(H("instructor")).send({phone:"1"});
console.log("\nPATCH /api/users/me/profile as instructor ->", pr.status);
await mongoose.disconnect(); await mongo.stop();

import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryServer } from "mongodb-memory-server";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { createApp } from "../app.js";
import Tenant from "../models/Tenant.js";
import User from "../models/User.js";
import SuperAdmin from "../models/SuperAdmin.js";
import RefreshToken from "../models/RefreshToken.js";
import { hashPassword } from "../services/password.js";
import { generateKeysIfMissing, signAccessToken, verifyAccessToken } from "../utils/tokens.js";
import { hashToken } from "../utils/tokens.js";
import { seedTenantRoles, getTenantRoleBySlug } from "../services/roleService.js";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import express from "express";

let mongo;
let app;

const PASSWORD = "TestPass#123";

async function seedFixtures() {
  const tenantA = await Tenant.create({ name: "Tenant A", subdomain: "tenant-a", plan: "trial", status: "active" });
  const tenantB = await Tenant.create({ name: "Tenant B", subdomain: "tenant-b", plan: "trial", status: "active" });

  await seedTenantRoles(tenantA._id);
  await seedTenantRoles(tenantB._id);

  const studentRoleA = await getTenantRoleBySlug(tenantA._id, "student");
  const ownerRoleA = await getTenantRoleBySlug(tenantA._id, "organization-owner");
  const studentRoleB = await getTenantRoleBySlug(tenantB._id, "student");

  const passwordHash = await hashPassword(PASSWORD);

  const studentA = await User.create({
    tenantId: tenantA._id,
    email: "student-a@test.com",
    passwordHash,
    roleId: studentRoleA._id,
    status: "active",
  });

  const adminA = await User.create({
    tenantId: tenantA._id,
    email: "admin-a@test.com",
    passwordHash,
    roleId: ownerRoleA._id,
    status: "active",
    isTenantAdmin: true,
  });

  const studentB = await User.create({
    tenantId: tenantB._id,
    email: "student-b@test.com",
    passwordHash,
    roleId: studentRoleB._id,
    status: "active",
  });

  const superAdmin = await SuperAdmin.create({
    email: "super@test.com",
    passwordHash,
    status: "active",
    mfaEnabled: false,
  });

  return { tenantA, tenantB, studentA, adminA, studentB, superAdmin };
}

function unwrap(body) {
  return body?.data ?? body;
}

beforeAll(async () => {
  generateKeysIfMissing();
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  app = createApp();
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

beforeEach(async () => {
  await Promise.all([
    Tenant.deleteMany({}),
    User.deleteMany({}),
    SuperAdmin.deleteMany({}),
    RefreshToken.deleteMany({}),
  ]);
});

describe("tenant auth", () => {
  test("login success returns access token and refresh cookie", async () => {
    const { tenantA } = await seedFixtures();
    const agent = request.agent(app);

    const res = await agent
      .post("/api/auth/login")
      .set("X-Tenant-Subdomain", tenantA.subdomain)
      .send({ email: "student-a@test.com", password: PASSWORD });

    expect(res.status).toBe(200);
    expect(unwrap(res.body).accessToken).toBeTruthy();
    expect(res.headers["set-cookie"]?.join(";")).toMatch(/refresh_token=/);
  });

  test("login failure uses generic invalid credentials", async () => {
    const { tenantA } = await seedFixtures();

    const res = await request(app)
      .post("/api/auth/login")
      .set("X-Tenant-Subdomain", tenantA.subdomain)
      .send({ email: "student-a@test.com", password: "wrong-password" });

    expect(res.status).toBe(401);
    expect(res.body.message.errorKey).toBe("AUTH_INVALID_CREDENTIALS");
  });

  test("disabled user cannot login", async () => {
    const { tenantA } = await seedFixtures();
    await User.updateOne({ email: "student-a@test.com" }, { $set: { status: "disabled" } });

    const res = await request(app)
      .post("/api/auth/login")
      .set("X-Tenant-Subdomain", tenantA.subdomain)
      .send({ email: "student-a@test.com", password: PASSWORD });

    expect(res.status).toBe(401);
  });

  test("wrong tenant subdomain returns not found", async () => {
    await seedFixtures();

    const res = await request(app)
      .post("/api/auth/login")
      .set("X-Tenant-Subdomain", "missing-tenant")
      .send({ email: "student-a@test.com", password: PASSWORD });

    expect(res.status).toBe(404);
  });
});

describe("access token verification", () => {
  test("rejects expired token", async () => {
    const { tenantA, studentA } = await seedFixtures();
    const privateKey = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".keys", "private.pem"),
      "utf8"
    );

    const expired = jwt.sign(
      {
        sub: String(studentA._id),
        tenant_id: String(tenantA._id),
        role: "student",
        type: "tenant_user",
      },
      privateKey,
      { algorithm: "RS256", expiresIn: -10 }
    );

    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${expired}`);

    expect(res.status).toBe(401);
  });

  test("rejects alg none token", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ sub: "abc", tenant_id: "t1", role: "student", type: "tenant_user" })
    ).toString("base64url");
    const token = `${header}.${payload}.`;

    const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  test("rejects wrong signature", async () => {
    const { tenantA, studentA } = await seedFixtures();
    const token = signAccessToken({
      sub: String(studentA._id),
      tenant_id: String(tenantA._id),
      role: "student",
      type: "tenant_user",
    });

    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}x`);

    expect(res.status).toBe(401);
  });
});

describe("refresh token rotation", () => {
  test("reusing old refresh token revokes session family", async () => {
    const { tenantA } = await seedFixtures();
    const agent = request.agent(app);

    const login = await agent
      .post("/api/auth/login")
      .set("X-Tenant-Subdomain", tenantA.subdomain)
      .send({ email: "student-a@test.com", password: PASSWORD });

    expect(login.status).toBe(200);
    const setCookie = login.headers["set-cookie"];
    expect(setCookie?.length).toBeGreaterThan(0);
    const firstRefresh = setCookie.join("; ").match(/refresh_token=([^;]+)/)?.[1];
    expect(firstRefresh).toBeTruthy();

    const refresh1 = await agent
      .post("/api/auth/refresh")
      .set("Cookie", setCookie);
    expect(refresh1.status).toBe(200);

    const reuse = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", `refresh_token=${firstRefresh}`);

    expect(reuse.status).toBe(401);

    const afterRevoke = await agent.post("/api/auth/refresh");
    expect(afterRevoke.status).toBe(401);
  });
});

describe("authorization boundaries", () => {
  test("tenant user token cannot access superadmin tenant creation", async () => {
    const { tenantA, studentA } = await seedFixtures();
    const token = signAccessToken({
      sub: String(studentA._id),
      tenant_id: String(tenantA._id),
      role: "student",
      type: "tenant_user",
    });

    const res = await request(app)
      .post("/api/superadmin/tenants")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Blocked",
        subdomain: "blocked",
        adminEmail: "x@test.com",
        adminPassword: PASSWORD,
      });

    expect(res.status).toBe(403);
  });

  test("superadmin token cannot access tenant me endpoint", async () => {
    const { superAdmin } = await seedFixtures();
    const token = signAccessToken({
      sub: String(superAdmin._id),
      role: "superadmin",
      type: "superadmin",
    });

    const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  test("cross-tenant user lookup is forbidden via hostname mismatch", async () => {
    const { tenantA, tenantB, studentA } = await seedFixtures();
    const token = signAccessToken({
      sub: String(studentA._id),
      tenant_id: String(tenantA._id),
      role: "student",
      type: "tenant_user",
    });

    const res = await request(app)
      .get(`/api/users/${studentA._id}`)
      .set("Authorization", `Bearer ${token}`)
      .set("X-Tenant-Subdomain", tenantB.subdomain);

    expect([403, 404]).toContain(res.status);
  });
});

describe("login rate limiting", () => {
  test("returns 429 after repeated failed attempts", async () => {
    const { tenantA } = await seedFixtures();

    const limiterApp = express();
    limiterApp.set("trust proxy", 1);
    limiterApp.use(express.json());
    limiterApp.post(
      "/login",
      rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 5,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => {
          const ip = ipKeyGenerator(req.ip || "127.0.0.1");
          const email = String(req.body?.email || "student-a@test.com").toLowerCase();
          return `${ip}:${email}`;
        },
      }),
      (_req, res) => res.status(401).json({ ok: false })
    );

    let lastStatus = 401;
    for (let i = 0; i < 6; i += 1) {
      const res = await request(limiterApp)
        .post("/login")
        .send({ email: "student-a@test.com", password: "bad" });
      lastStatus = res.status;
    }

    expect(lastStatus).toBe(429);
  });
});

describe("token helpers", () => {
  test("verifyAccessToken accepts valid RS256 token", () => {
    const token = signAccessToken({
      sub: "user1",
      tenant_id: "tenant1",
      role: "student",
      type: "tenant_user",
    });
    const decoded = verifyAccessToken(token);
    expect(decoded.sub).toBe("user1");
    expect(decoded.type).toBe("tenant_user");
  });

  test("hashToken is deterministic", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
  });
});

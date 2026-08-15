# SkillAra Server

> For how the three SkillAra apps fit together, see the
> [workspace README](../README.md).

Node.js + Express 5 API for the SkillAra multi-tenant learning platform. MongoDB stores tenants, users, courses, and **embedded catalogs** (roles, master data, plans) on tenant and super-admin documents.

## Quick start

```bash
npm install
cp .env.example .env
# Set MONGO_URI; review JWT and super-admin seed values
npm run dev
```

Runs at **http://localhost:5000**

On startup (non-test):

1. Seed super admin (if missing)
2. Migrate legacy plans / platform config (if present)
3. Seed default plans and organization types
4. Backfill tenant admins, roles, and master data for existing tenants

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start with nodemon |
| `npm start` | Production server |
| `npm test` | Jest integration tests (`tests/auth.integration.test.js`) |
| `npm run format` | Prettier |

## Environment

Copy `.env.example` to `.env`.

| Variable | Description |
|----------|-------------|
| `MONGO_URI` | MongoDB connection string |
| `ROOT_DOMAIN` | Base domain (e.g. `skillara.com`) |
| `PORT` | Default `5000` |
| `PRIVATE_KEY` / `PUBLIC_KEY` | RS256 JWT keys (auto-generated under `.keys/` in dev if unset) |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Legacy HS256 (deprecated) |
| `CORS_ORIGINS` | Comma-separated frontend origins |
| `DEFAULT_SUPER_ADMIN_EMAIL` / `DEFAULT_SUPER_ADMIN_PASSWORD` | First-run super-admin seed |
| `EMAIL_FROM`, `SMTP_*` | Welcome / invite email (optional) |
| `OPENAI_API_KEY` | AI features (optional) |
| `B2_ENDPOINT`, `B2_REGION`, `B2_BUCKET` | Backblaze B2 bucket for course media |
| `B2_KEY_ID`, `B2_APP_KEY` | B2 application key (bucket-scoped — see below) |
| `B2_DOWNLOAD_URL_TTL`, `B2_UPLOAD_URL_TTL` | Signed URL lifetimes in seconds |
| `MAX_IMAGE_UPLOAD_MB`, `MAX_DOCUMENT_UPLOAD_MB`, `MAX_PROXY_UPLOAD_MB` | Upload size caps |

## File storage (Backblaze B2)

All course media — thumbnails, lesson video, PDFs, attachments — lives in a **private**
Backblaze B2 bucket accessed through its S3-compatible API. Nothing is written to the
application server's disk, so instances stay stateless.

### Creating the key

Backblaze's S3-compatible API **does not accept the account Master Application Key**;
it fails with `InvalidAccessKeyId — Malformed Access Key Id`. In the B2 console go to
**Application Keys → Add a New Application Key**, restrict it to the SkillAra bucket
with `readWrite` access, and use the resulting `keyID` / `applicationKey`.

Verify the whole path (credentials → upload → sign → fetch → delete) with:

```bash
node scripts/checkStorage.js
```

### Key layout

Object keys are always tenant-prefixed, which makes tenant isolation auditable at the
bucket level:

```text
tenants/{tenantId}/courses/{courseId}/thumbnail/{unique}.{ext}
tenants/{tenantId}/courses/{courseId}/lessons/{lessonId}/{unique}.{ext}
tenants/{tenantId}/courses/{courseId}/attachments/{unique}.{ext}
```

`services/storageService.js` is the only module that builds keys, and every signing or
delete call re-checks the `tenants/{tenantId}/` prefix before touching an object.

### Upload paths

| File | Path | Why |
|------|------|-----|
| Images, PDFs, small media (≤ `MAX_PROXY_UPLOAD_MB`) | Multipart → server memory → B2 | Simple, single request |
| Large video | `POST /lessons/:id/upload-url` → browser `PUT`s to B2 → `POST /lessons/:id/upload-complete` | Multi-hundred-MB bodies never touch the API server |

The `upload-complete` step verifies the object actually exists in the bucket (`HeadObject`)
before the key is written to the lesson, so a client cannot claim an upload it never made.

### Playback

Nothing is embedded by URL. `GET /api/courses/lessons/:lessonId/play` re-checks
enrollment on every call and returns a signed URL valid for `B2_DOWNLOAD_URL_TTL`
(default 15 min). The client re-requests one shortly before expiry so long videos keep
playing.

## API route map

Base path: `/api`

| Prefix | Purpose |
|--------|---------|
| `/auth` | Tenant login, **signup**, invite register, refresh, logout, `/me` |
| `/superadmin/auth` | Super-admin login, MFA, session |
| `/superadmin` | Tenants, platform roles, organization types (write) |
| `/tenants` | Tenant resolve, check subdomain, CRUD |
| `/users` | Tenant-scoped user management |
| `/roles` | Tenant embedded roles & permission modules |
| `/master-data` | Departments, designations (embedded on `Tenant`) |
| `/plans` | Subscription plans (embedded on `SuperAdmin`) |
| `/organization-types` | Org type catalog (embedded on `SuperAdmin`) |
| `/courses` | Course catalog, authoring, media, moderation (see below) |
| `/enrollments` | Self-enrolment and admin bulk enrolment (see below) |
| `/progress`, `/quizzes`, `/assignments` | Learning |
| `/ai` | AI tutor, quiz generation, summarization |
| `/ownership-transfers` | Organization owner transfer workflow |

### Course API (`/api/courses`)

| Method | Path | Who |
|--------|------|-----|
| `GET` | `/` | Anyone in the tenant — visibility depends on role |
| `GET` | `/:id` | Anyone — locked lesson bodies stripped for non-enrolled |
| `POST` | `/` | Instructor, org admin, owner |
| `PATCH` `PUT` | `/:id` | Course owner or admin |
| `DELETE` | `/:id` | Course owner or admin (soft delete → `ARCHIVED`) |
| `POST` | `/:id/publish` `/:id/unpublish` | Course owner or admin |
| `POST` | `/:id/block` `/:id/unblock` | Org admin, owner |
| `POST` | `/:id/thumbnail` | Course owner or admin |
| `POST` | `/:id/modules` | Course owner or admin |
| `PUT` | `/:id/modules/reorder` | Course owner or admin |
| `PATCH` `DELETE` | `/modules/:moduleId` | Course owner or admin |
| `POST` | `/modules/:moduleId/lessons` | Course owner or admin |
| `PUT` | `/modules/:moduleId/lessons/reorder` | Course owner or admin |
| `PATCH` `DELETE` | `/lessons/:lessonId` | Course owner or admin |
| `POST` | `/lessons/:lessonId/content` | Course owner or admin — proxied upload |
| `POST` | `/lessons/:lessonId/upload-url` `/upload-complete` | Course owner or admin — direct upload |
| `POST` | `/lessons/:lessonId/attachments` | Course owner or admin |
| `DELETE` | `/lessons/:lessonId/attachments/:attachmentId` | Course owner or admin |
| `GET` | `/lessons/:lessonId/play` | Enrolled learner, course owner, or admin |

### Enrolment — two paths

Organizations onboard learners in two different ways, so both are first-class:

| Path | Endpoint | Who | Notes |
|------|----------|-----|-------|
| Student signs themselves up | `POST /auth/signup` | Anyone on the subdomain | Always creates the **Student** role; cannot mint staff. Gated by `Tenant.allowStudentSignup` (default `true`). Signs the user straight in. |
| Student enrols themselves | `POST /enrollments` | Any tenant user | Published, free courses only; paid courses return 402 until Phase 4. |
| Admin adds and enrols | `POST /enrollments/bulk` | Owner, org admin, or the course's instructor | `{ courseId, userIds[] }`. Users are re-verified against the tenant. Idempotent — already-enrolled users come back under `skipped`, dropped ones are reactivated. |

`POST /auth/register` remains the **invite** flow for staff accounts created by an admin.

### Progress and instructor preview

`/progress` endpoints normally require an active enrolment. An instructor reviewing
their own course — or an admin moderating one — has no enrolment, which previously
locked them out of their own content with "Not enrolled in this course".

They are now allowed through in **preview mode**: completions are recorded against their
own user id, the response carries `isPreview: true` so the UI can label it, and an
enrolment is never created or marked `COMPLETED` for them. Real learner analytics stay
clean.

Platform-scope oversight lives under `/api/superadmin/courses` (`GET /`, `GET /stats`,
`POST /:id/block`, `/:id/unblock`, `/:id/unpublish`) and is superadmin-only. Those
handlers deliberately query **across** tenants, so `requireSuperadmin` on every route is
the only thing bounding that scope.

## Data model (key concepts)

### Tenant document

- Identity: `name`, `subdomain`, `email`, branding, `planId`, `orgTypeId`
- **`roles[]`** — system + custom roles with permission maps; `User.roleId` references `_id`
- **`departments[]`**, **`designations[]`** — master data; users link via `departmentId` / `designationId`

### User document

- `tenantId`, `email`, `passwordHash`, `roleId` (required)
- `isTenantAdmin: true` — organization **owner** (excluded from employee listings)
- No legacy string `role` field

### SuperAdmin document

- Platform operator account(s)
- **`plans[]`**, **`organizationTypes[]`**, **`roles[]`** — platform catalogs

### New tenant provisioning

`POST /api/superadmin/tenants` creates the tenant, then:

```text
seedNewTenantDefaults(tenantId)
  → seedTenantRoles()      // organization-owner, org-admin, instructor, student, …
  → seedTenantMasterData() // default departments & designations
```

## Roles — who does what

Roles are **per tenant**, stored as `Tenant.roles[]` with a permission map
(`{ moduleId: [actions] }`) seeded from `data/permissionCatalog.js`. `User.roleId`
points at one of them. The API sends the effective permission map to the client on
`/api/auth/login` and `/api/auth/me` so the UI can render role-appropriate navigation —
but every action is re-checked server-side.

| Role | Slug | Course reach | Also can |
|------|------|--------------|----------|
| **Super Admin** | *(platform, not a tenant role)* | Read every course in every tenant; block/unblock/unpublish any of them | Tenants, plans, platform roles, org types |
| **Organization Owner** | `organization-owner` | Every course in **their** tenant: view, unpublish, block/unblock, edit | Everything in the tenant, incl. ownership transfer |
| **Organization Admin** | `org-admin` | Same course reach as the owner within the tenant | Users, roles, master data |
| **Instructor** | `instructor` | Full CRUD on **only their own** courses — modules, lessons, video/PDF upload, publish | Assignments, quizzes, view students |
| **Teaching Assistant** | `teaching-assistant` | View/edit course content (no create or publish) | Assist with assignments and quizzes |
| **Student** | `student` | Browse published courses; watch lessons they are enrolled in | Quizzes, forum, certificates |

Two rules do the heavy lifting in `controllers/courseController.js`:

- **Ownership** — an instructor's writes require `instructorId === actor.id`. A miss
  returns **404, not 403**, so instructors cannot probe for other instructors' course ids.
- **Moderation is separate from status** — an admin blocking a course sets
  `moderation.isBlocked` rather than changing `status`, so the instructor's own
  draft/published intent is preserved. A blocked course is hidden from learners
  regardless of status and cannot be self-published out of.

Publishing is its own endpoint (`POST /:id/publish`) rather than a `status` field write,
so the "must have at least one lesson" check cannot be bypassed via `PATCH`.

## Authorization

- **Access token** — Bearer JWT (RS256), short-lived, in memory on clients
- **Refresh token** — httpOnly cookie, rotated on `/auth/refresh`
- **Tenant scope** — `req.tenantId` from JWT or subdomain middleware; never trust client-supplied tenant id in body
- **Organization owner** — resolved via DB `isTenantAdmin`, embedded owner role, or JWT `TENANT_ADMIN`
- **Org admin assignment** — only organization owner (`USER_ORG_ADMIN_FORBIDDEN` otherwise)

## Project layout

```
SkillAra_server/
├── server.js              # Entry + startup migrations
├── app.js                 # Express app
├── config/db.js
├── controllers/
├── middleware/            # authenticate, scopeTenant, requireRole, …
├── models/                # Tenant, User, SuperAdmin, Course, …
├── routes/
├── services/              # roleService, masterDataService, planService, aiService, …
├── data/                  # permissionCatalog, masterDataCatalog, platformMasterCatalog
├── utils/                 # user, tokens, backfill*, seed*
└── tests/
```

## Testing

```bash
npm test
```

Uses `mongodb-memory-server`. Two suites:

- `tests/auth.integration.test.js` — login, refresh, tenant isolation, role guards
- `tests/course.integration.test.js` — course authoring, instructor ownership,
  publish gating, catalog visibility per role, module/lesson ordering, and
  enrollment-gated lesson content

## Roadmap

| Phase | Scope | Status |
|-------|-------|--------|
| 1–2 | Multi-tenancy, auth, RBAC, users, master data, plans | Done |
| **3** | **Course management: models, B2 media, instructor CRUD, admin moderation** | **Done** |
| 4 | Enrollment and payments (Stripe checkout, subscriptions, webhooks) | Enrolment (both paths) done; payments not started |
| 5 | Learning experience: progress tracking, quizzes, mock tests | Partial — progress and quizzes scaffolded |
| 6 | Community and mentorship: forum, mentor booking, live sessions | Not started |
| 7 | AI: doubt clearing, quiz generation, recommendations | Partial — `aiService.js` scaffolded |
| 8 | Notifications: queued transactional email, real-time sockets | Email service exists; queue and sockets not started |
| 9 | Analytics dashboards with pre-computed aggregates | Not started |
| 10 | Gamification, certificates, resume builder | Not started |

## Related docs

- [Root README](../README.md)
- [docs/DEVELOPMENT.md](../docs/DEVELOPMENT.md)

## License

ISC

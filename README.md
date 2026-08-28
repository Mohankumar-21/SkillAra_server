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
| `/mock-tests` | Course-scoped timed tests, manual or AI-generated |
| `/session-slots` | Bookable time slots — mock interviews and mentorship scheduling (see below) |
| `/forum` | Q&A: questions, answers, voting, moderation |
| `/mentorship` | Mentor profiles, mentorship requests |
| `/live-sessions` | Instructor-scheduled live classes, enrollment-gated join |
| `/ai` | AI tutor, quiz generation, summarization |
| `/ownership-transfers` | Organization owner transfer workflow |

Realtime signaling for live video (mock interviews, mentorship, live classes) runs
alongside the REST API as a Socket.io namespace at `/socket.io/webrtc` — see
[Live video](../README.md#live-video-mock-interviews-mentorship-live-classes) in the root README.

### Course API (`/api/courses`)

| Method | Path | Who |
|--------|------|-----|
| `GET` | `/` | Anyone in the tenant — visibility depends on role |
| `GET` | `/:id` | Anyone — locked lesson bodies stripped for non-enrolled |
| `POST` | `/` | Instructor, org admin, owner |
| `PATCH` `PUT` | `/:id` | Course owner or admin |
| `DELETE` | `/:id` | Course owner or admin (soft delete → `ARCHIVED`) |
| `POST` | `/:id/publish` `/:id/unpublish` | `courses:publish` — **requires an approved content review** |
| `GET` | `/reviewers` | `courses:submit` — people who may be sent a course to review |
| `GET` | `/review-queue` | `courses:approve` — courses waiting on you |
| `GET` | `/:id/review` | Course owner, assigned reviewer, or moderator |
| `POST` | `/:id/submit-review` | `courses:submit` |
| `POST` | `/:id/review/approve` `/:id/review/request-changes` | `courses:approve` |
| `POST` | `/:id/block` `/:id/unblock` | `courses:moderate` — taking a *live* course down, deliberately not `approve` |
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

### Content review (`/api/courses/:id/...`)

A course cannot be published until a content reviewer has approved it.

```text
NOT_SUBMITTED ──submit-review──▶ PENDING ──review/approve──▶ APPROVED ──publish──▶ live
                                    │                                        │
                                    └──review/request-changes──▶            unpublish
                                            CHANGES_REQUESTED  ──submit──▶ PENDING
```

- The instructor picks a reviewer from `GET /reviewers`, which lists every user whose role
  grants `courses:approve`. Rename or clone the Content Reviewer role and it still works —
  the list is derived from the permission matrix, never from a role name.
- The assigned reviewer can open the draft and its lesson media even though they are neither
  the author nor an admin; nobody else can.
- `request-changes` requires a note — a rejection with no explanation is not actionable.
- Anyone who can moderate the catalog can also decide a review, so it is never stuck behind
  an absent reviewer.
- Approval is consumed by publishing: unpublishing resets the course to `NOT_SUBMITTED`, so
  edits made after going live go through review again.
- Every decision appends to `Course.review.history`.

### Notifications (`/api/notifications`)

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/` | Your inbox — `?unreadOnly=true`, `?page`, `?limit` |
| `GET` | `/unread-count` | Badge count |
| `PATCH` | `/:id/read` | Mark one read |
| `POST` | `/read-all` | Mark everything read |

Written on review assignment, changes requested, approval, and publish. One row per
recipient, so the unread count is a single indexed query.

These endpoints are deliberately **not** behind `requirePermission("notifications", ...)`:
an inbox is self-scoped to the caller, and gating it would only let a role be configured out
of its own notifications. Writing a notification never fails the action that triggered it.

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

### Scheduling — mock interviews and mentorship (`/api/session-slots`)

Mock interviews and mentorship sessions share one model, `BookableSlot`
(`sessionType: MOCK_INTERVIEW | MENTORSHIP`), instead of two near-identical booking
flows:

| Method | Path | Who |
|--------|------|-----|
| `POST` | `/` | Instructor/mentor — publishes an open slot |
| `GET` | `/` | Any tenant user — browse open slots (`?sessionType=&courseId=&hostId=`) |
| `GET` | `/my` | Slots the caller hosts or has booked |
| `POST` | `/:id/book` | Student — claims an `OPEN` slot; attaches a meeting room |
| `POST` | `/:id/cancel` | Host or the booked student |
| `POST` | `/:id/complete` | Host — marks done, optional feedback (mock interviews) |
| `DELETE` | `/:id` | Host — remove an unbooked `OPEN` slot |

Mentorship additionally has its own ask/accept step before scheduling:
`PUT /api/mentorship/profile` (become listed as a mentor), `GET /api/mentorship/mentors`
(browse), `POST /api/mentorship/requests` (student asks), `PATCH
/api/mentorship/requests/:id/respond` (mentor accepts/rejects) — once accepted, the
mentor publishes a `BookableSlot` the student books like a mock interview.

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

**A role is nothing but its permission map.** There is no second, hidden privilege tier:
every tenant route is gated by `requirePermission(moduleId, action)` against
`Tenant.roles[].permissions`, so a custom role an admin builds in the UI has exactly the
reach its checkboxes describe. Eight roles are seeded per tenant; admins add as many more as
they like, and the API and navigation both follow automatically.

| Seeded role | Slug | Course reach | Also can |
|------|------|--------------|----------|
| **Super Admin** | *(platform, not a tenant role)* | Read every course in every tenant; block/unblock/unpublish any of them | Tenants, plans, platform roles, org types |
| **Organization Owner** | `organization-owner` | Everything, including approving and publishing | Everything in the tenant, incl. ownership transfer |
| **Organization Admin** | `org-admin` | Author, approve, publish, moderate | Users, roles, master data |
| **Instructor** | `instructor` | Full CRUD on **only their own** courses; submits them for review | Assignments, quizzes, live sessions, mentorship |
| **Teaching Assistant** | `teaching-assistant` | View/edit course content — no create, publish, or submit | Assist with assignments and quizzes |
| **Mentor** | `mentor` | — | Mentorship queue, mock interviews, live sessions |
| **Content Reviewer** | `content-reviewer` | Read any course assigned to them; approve it or send it back. Cannot block a live course — that is `courses:moderate`, an admin power | Approve lessons, assignments, quizzes, certificates |
| **Support** | `support` | — | Moderate the forum and community, view users |
| **Learner** | `learner` | Browse published courses; watch lessons they are enrolled in | Attempt quizzes and mock tests, forum, mentorship |

`legacyRole` / `legacyApiRole` on a role are **display and client-routing hints only** —
never consulted for authorization. On custom roles they are *derived* from the permission
map (`deriveLegacyApiRole`), never accepted from request input, so a caller who can create
roles cannot mint themselves a privilege tier. `TENANT_ADMIN` is unreachable by derivation;
organization ownership comes from `isOwnerRole` alone.

Two rules do the heavy lifting in `controllers/courseController.js`:

- **Ownership** — an instructor's writes require `instructorId === actor.id`. A miss
  returns **404, not 403**, so instructors cannot probe for other instructors' course ids.
- **Moderation is separate from status** — an admin blocking a course sets
  `moderation.isBlocked` rather than changing `status`, so the instructor's own
  draft/published intent is preserved. A blocked course is hidden from learners
  regardless of status and cannot be self-published out of.

Publishing is its own endpoint (`POST /:id/publish`) rather than a `status` field write,
so neither the "must have at least one lesson" check nor the content-review gate can be
bypassed via `PATCH`.

## Authorization

Three gates, and only three:

| Gate | Guards | Used for |
|------|--------|----------|
| `requirePermission(moduleId, action)` | `Tenant.roles[].permissions` | **Every** tenant route |
| `requireOwner` | the role's `isOwnerRole` flag | Ownership transfer only — singular per tenant, so not expressible as a permission |
| `requireRole("SUPER_ADMIN")` | platform principal | Super admins live in the `SuperAdmin` collection, not `Tenant.roles[]` |

`requireRole()` **throws at route-definition time** if handed a tenant role name, so the old
"four hardcoded buckets" path cannot come back by accident.

- **Access token** — Bearer JWT (RS256), short-lived, in memory on clients
- **Refresh token** — httpOnly cookie, rotated on `/auth/refresh`
- **Tenant scope** — `req.tenantId` from JWT or subdomain middleware; never trust client-supplied tenant id in body
- **Role resolution** — `authenticate()` reads `roleId` from the database row it already loads
  to validate the token, not from the token itself, so a role or permission change takes
  effect on the next request rather than at the next token refresh
- **Org admin assignment** — only organization owner (`USER_ORG_ADMIN_FORBIDDEN` otherwise)
- **Seed drift** — `backfillRolesAndPermissions()` re-syncs `roleType: "system"` roles to the
  current catalog on every boot, so tenants provisioned before a catalog change do not sit on
  a stale permission map. Custom roles are never touched.

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
| **5** | **Learning experience: progress tracking, quizzes, mock tests, mock interviews** | **Done (backend)** |
| **6** | **Community and mentorship: forum, mentor booking, live sessions** | **Done (backend)** |
| 7 | AI: doubt clearing, quiz generation, recommendations | Partial — `aiService.js` scaffolded |
| 8 | Notifications: queued transactional email, real-time sockets | Email service exists; queue and sockets not started |
| 9 | Analytics dashboards with pre-computed aggregates | Not started |
| 10 | Gamification, certificates, resume builder | Not started |

## Related docs

- [Root README](../README.md)
- [docs/DEVELOPMENT.md](../docs/DEVELOPMENT.md)

## License

ISC

# SkillAra Server

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

## API route map

Base path: `/api`

| Prefix | Purpose |
|--------|---------|
| `/auth` | Tenant login, refresh, logout, `/me`, set-initial-password |
| `/superadmin/auth` | Super-admin login, MFA, session |
| `/superadmin` | Tenants, platform roles, organization types (write) |
| `/tenants` | Tenant resolve, check subdomain, CRUD |
| `/users` | Tenant-scoped user management |
| `/roles` | Tenant embedded roles & permission modules |
| `/master-data` | Departments, designations (embedded on `Tenant`) |
| `/plans` | Subscription plans (embedded on `SuperAdmin`) |
| `/organization-types` | Org type catalog (embedded on `SuperAdmin`) |
| `/courses`, `/enrollments`, `/progress`, `/quizzes`, `/assignments` | Learning |
| `/ai` | AI tutor, quiz generation, summarization |
| `/ownership-transfers` | Organization owner transfer workflow |

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

Uses `mongodb-memory-server` and exercises auth login, refresh, tenant isolation, and role guards.

## Related docs

- [Root README](../README.md)
- [docs/DEVELOPMENT.md](../docs/DEVELOPMENT.md)

## License

ISC

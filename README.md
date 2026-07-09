# SkillAra Server

Node.js + Express API for the SkillAra multi-tenant learning platform.

## Quick start

```bash
npm install
cp .env.example .env
# Edit .env — set MONGO_URI and JWT secrets
npm run dev
```

Runs at **http://localhost:5000**

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start with nodemon |
| `npm start` | Start production server |
| `npm run format` | Format with Prettier |

## Documentation

See the root project docs:

- [README.md](../README.md) — overview & quick start
- [docs/DEVELOPMENT.md](../docs/DEVELOPMENT.md) — full API, models, and development status

## Environment

Copy `.env.example` to `.env`. Required variables:

- `MONGO_URI` — MongoDB connection string
- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` — token signing secrets
- `ROOT_DOMAIN` — e.g. `skillara.com`
- `DEFAULT_SUPER_ADMIN_EMAIL` / `DEFAULT_SUPER_ADMIN_PASSWORD` — first-run seed

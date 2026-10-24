# Watchable Documentation & Guides

This directory contains technical guides, architectural notes, and database migrations for the Watchable platform.

---

## 📚 Guides Directory (`docs/guides/`)

| Document | Topic | Description |
|---|---|---|
| [`architecture.md`](./guides/architecture.md) | Architecture | Core architectural overview of Watchable |
| [`DEPLOYMENT_GUIDE.md`](./guides/DEPLOYMENT_GUIDE.md) | Deployment | Vercel & serverless deployment instructions |
| [`DEPLOYMENT_CHECKLIST.md`](./guides/DEPLOYMENT_CHECKLIST.md) | Checklist | Pre-deployment verification checklist |
| [`RESOLVER_FIX.md`](./guides/RESOLVER_FIX.md) | Streaming | Stream resolution engine specifications |
| [`AUTO_FALLBACK_FEATURE.md`](./guides/AUTO_FALLBACK_FEATURE.md) | Streaming | Automatic fallback chain between native providers |
| [`MOBILE_WATCH_TOGETHER.md`](./guides/MOBILE_WATCH_TOGETHER.md) | Watch Party | Mobile sync & Watch Together protocol |
| [`PERFORMANCE_GUIDE.md`](./guides/PERFORMANCE_GUIDE.md) | Performance | Frontend caching, assets, and bundle optimization |
| [`CACHING_SOLUTION.md`](./guides/CACHING_SOLUTION.md) | Caching | Edge proxy and catalog cache strategy |
| [`ANTI_INSPECT_GUIDE.md`](./guides/ANTI_INSPECT_GUIDE.md) | Security | Client-side inspect & scraping protection |

---

## 🗄️ Database Schema

- [`supabase_schema_complete.sql`](./supabase_schema_complete.sql) - The single complete, unified SQL schema for the Supabase backend. Run this script in the Supabase SQL editor to create all tables, indexes, constraints, RLS policies, and triggers.

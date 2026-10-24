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

## 🗄️ Database Migrations (`docs/`)

Contains SQL migrations for Supabase/PostgreSQL:
- `supabase_schema_complete.sql` - Full consolidated schema
- `secure_supabase_rls.sql` - Row level security policies
- `comments_migration.sql` - Discussion & comments tables
- `notifications_polls_migration.sql` - Notification & poll structures
- `party_chat_migration.sql` - WatchTogether chat synchronization

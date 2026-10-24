# Watchable (Moovie)

A modern, high-performance web streaming application built with Vue 3, TypeScript, Vite, and Vercel Serverless streaming resolvers.

---

## 📁 Project Structure

```
watchable/
├── api/                       # Vercel Serverless Functions
│   └── stream/
│       ├── proxy.ts           # Edge-compatible HLS proxy
│       └── resolve.ts         # Multi-provider native stream scraper & resolver
├── src/
│   ├── assets/                # Global styles, SCSS themes & icons
│   │   └── css/               # Modular SCSS (moovie-frame.scss, stream-anime.scss, etc.)
│   ├── components/            # Vue UI components by domain
│   │   ├── ads/               # Ad banner placeholders
│   │   ├── cards/             # Media card grids and tiles
│   │   ├── detail/            # Show & movie detail widgets
│   │   ├── discover/          # Filter controls and sorting
│   │   ├── navigation/        # Header, command palette, navbars
│   │   ├── player/            # Native HLS video player (MoovieFrame, etc.)
│   │   └── primitives/        # Low-level reusable UI primitives
│   ├── composables/           # Vue 3 reactive hooks & state management
│   ├── pages/                 # Route page components
│   │   ├── Home.vue           # Homepage & featured carousels
│   │   ├── Movies.vue         # Movies browse
│   │   ├── TVShows.vue        # TV shows browse
│   │   ├── Anime.vue          # Anime browse
│   │   ├── StreamMovie.vue    # Full-screen movie player
│   │   ├── StreamTVShow.vue   # Full-screen series player with episode selector
│   │   └── StreamAnime.vue    # Full-screen anime player with SUB/DUB toggle
│   ├── routes/                # Vue Router route definitions
│   ├── types/                 # Shared TypeScript interfaces (stream, media, player)
│   └── utils/                 # General helpers and formatters
├── public/                    # Static assets, PWA manifests, icons
├── docs/                      # Technical documentation, guides & SQL migrations
│   └── guides/                # Architectural, performance & deployment guides
├── scripts/                   # Build tools & maintenance scripts
└── scratch/                   # Temporary development scripts & experiments
```

---

## ⚡ Streaming Architecture

Watchable operates on a **100% first-party native HLS streaming architecture**:
- **No external iframe embeds** (`megaplay`, `videasy`, etc. removed).
- **Native HLS Player (`MoovieFrame.vue`)**: Powered by `Hls.js` with quality selection, audio track switching (SUB/DUB), OpenSubtitles integration, and Watch Together room synchronization.
- **Serverless Resolver (`/api/stream/resolve`)**: Queries native provider APIs across Movies, TV Series, and Anime (`Shisui`, `Yuji`, `Megumi`, `Toji`, `Nobara`, `Goku`, `Itachi Anime`, `Saitama`, `Itachi`, `Madara`, `Obito`, `Minato`).
- **Edge Stream Proxy (`/api/stream/proxy`)**: Proxies HLS manifests and video segments with appropriate origin headers and CORS headers.

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ (Node 22 LTS recommended)
- Yarn 1.22+

### Development
```bash
# Install dependencies
yarn install

# Start local dev server (includes live /api/stream endpoints via Vite middleware)
yarn dev
```
Open `http://localhost:5173` in your browser.

### Type Check & Build
```bash
# Run TypeScript validation
yarn vue-tsc --noEmit

# Compile production bundle
yarn build
```

---

## 📖 Documentation
Detailed technical documentation, database schemas, and performance guides are available in the [docs/](./docs/README.md) directory.

# Furina Reader — Development Guide

> Your world. Your stories. Your library.

## 1. Repository inspection (Phase 1 findings, 2026-11-06)

The working folder `E:\furina-moviebox` contains **Furina MovieBox**, a separate, pre-existing
movie-streaming web app (React 18 + JS + Tailwind 3, third-party embed players). It shares nothing
with a manga/comic reader except branding. It was **left untouched**; Furina Reader is a new,
self-contained project in `furina-reader/`.

Toolchain found on this machine:

| Tool | Status | Impact |
|---|---|---|
| Node 24 / npm 11 | ✅ | Web build, tests |
| OpenJDK 21 | ✅ | Needed for Android Gradle builds |
| Android SDK | ❌ not installed | APK cannot be built here |
| Rust / Cargo | ❌ not installed | Tauri Windows installer cannot be built here |
| git | ❌ not installed | No commits possible here |

Useful MCPs: Playwright (browser automation / e2e), built-in browser preview, Context7 docs.
GitHub, Figma and other connectors require OAuth via `/mcp` and were not used.

## 2. Architecture

```
furina-reader/
├─ src/
│  ├─ core/                  ← platform-agnostic business logic (no React, no DOM UI)
│  │  ├─ types.ts            ← shared data model
│  │  ├─ db.ts               ← IndexedDB persistence (idb)
│  │  ├─ library.ts          ← titles, chapters, collections, statuses, duplicates
│  │  ├─ progress.ts         ← progress, history, statistics
│  │  ├─ backup.ts           ← JSON import / export
│  │  ├─ importers/          ← CBZ/ZIP, CBR, EPUB, PDF, images → PageSource
│  │  ├─ extensions/         ← SDK types, registry, sandbox host, built-in sources
│  │  ├─ downloads.ts        ← queue, pause/resume, retry, storage usage
│  │  ├─ ai/                 ← provider-independent AI client + spoiler guard
│  │  └─ sync/               ← Supabase client, outbox, merge/conflict resolution
│  ├─ platform/              ← web / Tauri / Capacitor adapters (back button, fullscreen…)
│  ├─ stores/                ← Zustand UI state (settings, reader prefs)
│  ├─ components/            ← design system (shadcn-style primitives), shell, logo
│  └─ features/              ← screens: home, discover, library, reader, …
├─ supabase/                 ← SQL migrations (RLS) + edge function (AI proxy)
├─ src-tauri/                ← Windows desktop shell (Tauri 2)
├─ android/ (generated)      ← `npx cap add android` creates it (Capacitor 6)
├─ docs/EXTENSION_SDK.md
└─ tests/                    ← Vitest unit tests + Playwright e2e
```

### Key decisions

- **Offline-first.** IndexedDB is the source of truth on every device. Cloud sync is additive: an
  outbox records every mutation and is pushed when a Supabase session exists; pulls merge with
  last-writer-wins per record (`updated_at`), with reading progress resolved by *furthest page
  wins* when the same chapter was read on two devices.
- **Content legality.** No catalogue content is scraped or bundled. Readable content comes from:
  1. the user's own files (CBZ, CBR, ZIP, EPUB, PDF, images);
  2. OPDS 1.x catalogues the user configures (e.g. their own Komga / Kavita / Calibre server);
  3. third-party extensions the user installs, which run sandboxed and only reach hosts they declare.
  Discovery metadata (covers, descriptions, genres, trending) comes from the public **AniList
  GraphQL API** (metadata only, no pages).
- **Reader engine** works on an abstract `PageSource` (count + lazy `load(i)`), so every format and
  source shares one engine. Only a sliding window of pages is decoded; object URLs outside it are
  revoked. Webtoon mode is virtualised with `@tanstack/react-virtual`.
- **Extension sandbox.** Untrusted extension code runs inside an `<iframe sandbox="allow-scripts">`
  (opaque origin — no access to app storage, cookies or DOM) with a CSP of `default-src 'none'`, so
  it cannot open network connections itself. All network goes through `host.fetch`, which the app
  checks against the manifest's declared hosts.
- **AI keys never ship to clients.** The app calls either the Supabase edge function
  `ai-assistant` (holds the provider key server-side, enforces per-user daily limits) or a
  user-chosen keyless endpoint (e.g. local Ollama). The spoiler guard limits context to chapters at
  or before the reader's current chapter unless spoilers are explicitly enabled.

## 3. Running

```bash
cd furina-reader
npm install
npm run dev          # http://localhost:5173
npm test             # unit tests
npm run fixtures     # generates tests/fixtures/*.cbz etc.
npm run test:e2e     # Playwright (starts the dev server itself)
npm run build        # production web build → dist/
```

Copy `.env.example` to `.env.local` to enable cloud features.

### Windows (Tauri 2)

Requires Rust (`rustup`), MSVC build tools and WebView2.
```bash
npm run tauri build   # → src-tauri/target/release/bundle/{msi,nsis}/
```

### Android (Capacitor 6)

Requires Android Studio / SDK (API 34) and JDK 17–21.
```bash
npx cap add android   # first time only
npm run cap:sync
npx cap open android  # or: cd android && ./gradlew assembleRelease
```

### Supabase

```bash
supabase link --project-ref <ref>
supabase db push                       # applies supabase/migrations
supabase functions deploy ai-assistant
supabase secrets set AI_PROVIDER=anthropic ANTHROPIC_API_KEY=... AI_MODEL=claude-sonnet-5-5
```

## 4. Phase log

See `TASKS.md` for the live checklist. Each phase records what was verified and how.

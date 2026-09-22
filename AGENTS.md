# Seedance Studio Agent Guide

## Project

Seedance Studio is a Chinese-first Next.js PWA for generating Seedance videos with each user's own Volcengine Ark API Key (BYOK).

## Commands

- Install: `npm install`
- Develop: `npm run dev` (default `http://localhost:3000`)
- Verify: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`
- Optional Cloudflare image proxy: `npm run worker:test` (Node.js 22+; local workerd and a mocked Ark upstream, no paid jobs).

## Stack

Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, Vitest, and Vercel-compatible route handlers.

## Structure

- `src/app/`: pages, global styles, manifest, and API routes
- `src/components/studio/`: video-generation UI
- `src/lib/video/`: provider, validation, reference images, prompts, and task state
- `src/lib/security/`: API-key parsing and rate limiting
- `src/lib/client/`: browser-only API-key storage
- `tests/`: Vitest coverage for UI, routes, provider, PWA, and security contracts
- `workers/seedance-proxy/`: optional streaming image proxy; see `docs/cloudflare-image-proxy.md` for deployment and live verification requirements

## Conventions

- Keep the UI Chinese-first and update both Chinese and English messages together.
- API Keys stay in browser `localStorage`; send them only through `x-seedance-api-key` and use them request-scoped on the server.
- Never log, persist, expose in URLs, or commit API Keys. Do not restore deployment-side Seedance keys or password sessions.
- Reference images use browser Data URLs; keep the existing count and payload-size limits unless requirements change.
- Add or update tests before behavior changes, then run the full verification commands.
- Preserve unrelated user changes in dirty worktrees.

## Current State

The current architecture is PWA + BYOK with no Vercel Blob dependency. `README.md` is the current usage and deployment contract; dated files under `docs/superpowers/` are planning history, not runtime authority.

Default uploads retain the 3 MiB image limits and 4,000,000-byte Vercel request limit. An explicitly configured `NEXT_PUBLIC_SEEDANCE_WORKER_ORIGIN` enables 15 MiB single / 45 MiB combined images; only oversized generation requests use that Worker. Its free-tier CPU budget and Ark input compatibility require deployed validation, not just passing local tests. Do not configure a third-party proxy or claim production readiness without that validation.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

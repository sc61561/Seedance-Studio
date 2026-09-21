# Seedance Compatibility Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the author-owned Endpoint dependency and make the four supported Seedance models, native image roles, validation, errors, and BYOK disclosure accurate for independent Volcengine Ark accounts.

**Architecture:** A shared capability registry is the single source of truth for the client and API route. The browser sends a validated model target, generation mode, final compiled prompt, and audio choice; the server validates the same selection and maps application-only fields to Ark request fields. Official model IDs infer their capability profile, while custom `ep-…` targets require an explicit profile that is never forwarded upstream.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, browser `localStorage`, Volcengine Ark async video API.

**Spec:** User-approved plan and the addendum in the current Codex task; upstream capability source is https://www.volcengine.com/docs/82379/1520757?lang=zh (verified 2026-09-20).

## Global Constraints

- Work from `origin/main` in branch `Lime/seedance-compatibility-fixes`; preserve unrelated user changes.
- Do not commit, push, merge, publish, or create a PR without a later explicit request.
- Keep Chinese as the default UI and update matching English strings.
- Support only Volcengine Ark Beijing and these four profiles: `doubao-seedance-2-5-260628`, `doubao-seedance-2-0-260128`, `doubao-seedance-2-0-fast-260128`, `doubao-seedance-2-0-mini-260615`.
- Never read a deployment `SEEDANCE_API_KEY`; never log, persist server-side, or include a key in a URL/error/task object.
- Keep the product image cap at 10 and total decoded image bytes at 3 MiB; Seedance 2.0 profiles further cap general references at 9.
- Reject serialized generation request bodies larger than 4,000,000 bytes.
- Only `reference` mode may use zero images; all other modes fail explicitly when their image counts are wrong.
- Existing activity task IDs remain queryable and are never converted into automatic paid resubmissions.

## Review Focus

- Official Model ID plus a conflicting `modelProfile` must be rejected, not used to unlock another profile's limits.
- Custom Endpoint without a profile must fail before Ark is called, while an already-created task remains recoverable.
- `first-frame`/`first-last` must emit only native roles and no contradictory prompt assistance.
- Data URL and HTTPS image input fields are mutually exclusive and all retained paths receive identical count/mode validation.
- Async task failures must preserve sanitized upstream classification/detail when present without exposing API keys or Base64 data.

---

### Task 1: Capability registry and locally stored model target

**Files:**
- Modify: `src/lib/video/models.ts`
- Create: `src/lib/client/model-settings-storage.ts`
- Create: `tests/models.test.ts`
- Create: `tests/model-settings-storage.test.ts`

**Interfaces:**
- Produce `OfficialSeedanceModelId`, `GenerationMode`, `SeedanceModelProfile`, `ResolvedSeedanceTarget`.
- Produce `resolveSeedanceTarget(model, modelProfile)` and `validateSeedanceSelection(profile, selection)`.
- Produce local storage helpers for `{ model, modelProfile? }`; custom Endpoint data stays browser-local.

- [ ] Write failing tests for all four profiles, per-profile durations/resolutions/reference caps, `adaptive`/`21:9`, exact custom Endpoint syntax, official/profile conflict rejection, and local storage sanitization.
- [ ] Run the two test files and verify failures are caused by missing registry/storage APIs.
- [ ] Implement the registry with display labels separate from wire values; include source URL and `verifiedAt: "2026-09-20"` metadata.
- [ ] Implement target resolution: official IDs infer their own profile; `ep-…` requires a matching official profile; arbitrary model strings fail.
- [ ] Implement resilient local storage read/save/clear functions without storing the API key.
- [ ] Run the focused tests and the full suite.

### Task 2: Prompt modes and Ark provider mapping

**Files:**
- Modify: `src/lib/video/prompt-compiler.ts`
- Modify: `src/lib/video/types.ts`
- Modify: `src/lib/video/providers/seedance.ts`
- Modify: `tests/prompt-compiler.test.ts`
- Modify: `tests/seedance-provider.test.ts`
- Modify: `tests/video-provider-contract.ts`

**Interfaces:**
- `CreateVideoInput` gains `modelProfile`, `generationMode`, and `generateAudio`.
- `VideoTaskStatus` gains optional `errorDetail` and `requestId` while preserving current fields.
- `generationMode` wire values are `reference | ordered-reference | first-frame | first-last`.

- [ ] Write failing tests proving prompt assistance is added only for `reference`/`ordered-reference`, native modes have no legacy keyframe text, and no mode silently downgrades.
- [ ] Write failing provider tests for `reference_image`, `first_frame`, `first_frame + last_frame`, and explicit `generate_audio` mapping.
- [ ] Write failing task-status tests for sanitized asynchronous Ark errors and optional Request ID.
- [ ] Implement minimal prompt/type changes and native role mapping.
- [ ] Centralize upstream error classification: upstream code first, HTTP status fallback; preserve ambiguity between not-found and unauthorized when Ark does.
- [ ] Run focused tests and the full suite.

### Task 3: Server-side request validation and compatibility

**Files:**
- Modify: `src/app/api/generate/route.ts`
- Modify: `src/app/api/task/[id]/route.ts`
- Modify: `tests/api-validation.test.ts`
- Modify: `tests/task-route.test.ts`

**Interfaces:**
- `POST /api/generate` accepts optional `modelProfile`, optional legacy `generationMode` defaulting to `reference`, and optional legacy `generateAudio` defaulting to `true`.
- Official Model IDs ignore no client profile: missing is allowed/inferred, matching is allowed, conflicting is rejected.
- Custom Endpoint without `modelProfile` returns `api.clientUpgradeRequired` without calling Ark.
- `GET /api/task/[id]` keeps its path/method and success shape, adding only optional failure metadata.

- [ ] Write failing table tests for every model's duration, resolution, 4K, ratio, and reference-image cap.
- [ ] Write failing tests for exact image-count rules, mutually exclusive image fields, full serialized body size, and 2.5 native-frame `adaptive` requirement.
- [ ] Write failing compatibility tests for missing legacy fields and custom Endpoint without profile.
- [ ] Implement validation using only the shared registry; pass validated values to the provider.
- [ ] Verify the rate limiter runs only after local validation, so invalid/upgrade requests never consume an Ark call.
- [ ] Run focused tests and the full suite.

### Task 4: Model, mode, audio, and final-prompt UI

**Files:**
- Modify: `src/components/studio/video-generator.tsx`
- Modify: `src/lib/i18n/messages.ts`
- Modify: `tests/video-generator.test.tsx`
- Modify: `tests/task-recovery.test.ts`

**Interfaces:**
- UI model selector offers four official models plus `custom-endpoint`; custom selection reveals Endpoint and capability-profile controls.
- Final prompt preview and submission call the same `buildFinalPrompt()` with the same current state snapshot.

- [ ] Write failing render/behavior tests for model choices, custom Endpoint controls, model-specific sliders/options, 4K warning, audio default-on control, and prompt-assistance labels.
- [ ] Write failing tests for exact image-mode hints/errors and final-prompt preview text/count.
- [ ] Implement model-driven controls. On model change, adjust invalid duration/resolution with a visible notice; never delete/reorder images or silently change generation mode.
- [ ] Serialize the request once, byte-check that exact string, and send that same string.
- [ ] Preserve existing task recovery; accept optional async error detail without discarding old task IDs.
- [ ] Run focused tests and the full suite.

### Task 5: PWA upgrade path and documentation disclosure

**Files:**
- Modify: `public/sw.js`
- Modify: `tests/service-worker.test.ts`
- Modify: `README.md`
- Modify: `src/lib/i18n/messages.ts`

**Interfaces:**
- Service worker moves from `seedance-shell-v1` to `seedance-shell-v2` and deletes older shell caches on activation.
- Compatibility documentation distinguishes simulated tests from real Ark verification per model/mode/resolution/audio combination.

- [ ] Write a failing service-worker cache-version test.
- [ ] Bump the cache and verify API requests remain network-only.
- [ ] Update API Key copy: persisted only in the browser, temporarily traverses this site's Next.js/Vercel proxy, not persisted by application code, self-hosting recommended where company policy requires it.
- [ ] Document official models, custom Endpoint/profile semantics, native vs prompt-assisted controls, HEVC/10-bit 4K warning, and request/image limits.
- [ ] Mark all real API combinations as “待验证” unless actually exercised with that exact combination.

### Task 6: Final verification and review

**Files:**
- Review all changed files; do not mutate unrelated files.

- [ ] Run `npm test` and record total passing files/tests.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
- [ ] Search tracked files and diff for `SEEDANCE_API_KEY`, the removed author Endpoint ID, API-key-shaped secrets, accidental Base64 fixtures, and unexpected environment dependencies.
- [ ] Inspect `git diff --check`, `git status --short`, and the complete diff.
- [ ] Obtain a fresh whole-branch review and fix any load-bearing findings.
- [ ] Report the isolated worktree path, changed behavior, verification evidence, and remaining real-account validation requirements without committing or pushing.

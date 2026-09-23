<p align="right"><a href="./README.md">中文</a> | <strong>English</strong></p>

<div align="center">

<a href="https://seedance-studio-five.vercel.app/">
  <img src="public/icons/icon-512.png" alt="Seedance Studio icon; open the web app" width="96" height="96">
</a>

<h1>Seedance Studio</h1>

<p>Bring your own Volcengine Ark API key to create videos from prompts and reference images.</p>

<h3><a href="https://seedance-studio-five.vercel.app/">Open the web app ↗</a></h3>

<p><a href="#run-locally">Run locally</a> &nbsp;&nbsp; <a href="#install-on-mobile">Install on mobile</a></p>

</div>

Seedance Studio is a Chinese-first video generation workspace that you can install on desktop or mobile. Save your own API key in the browser, then generate, preview, and download videos with Volcengine Ark Seedance. The deployer does not provide an API key.

## Bring your own key

This open-source app supports public Vercel deployments with a BYOK (Bring Your Own Key) model:

- Each user enters their own Volcengine Ark Seedance API key in the app.
- The key is hidden by default and can be saved, changed, or cleared.
- The key is stored only in this device's browser `localStorage`. It is not written to a database, task record, URL, log, or GitHub.
- For generation and task queries, the browser temporarily sends the key in the `x-seedance-api-key` header to the **current site's Next.js/Vercel proxy**. The server forwards it to Volcengine Ark for that request only. The app does not log or persist the key on the server.
- If the deployer enables the optional Cloudflare image proxy, large-image generation temporarily sends the key and images through that Worker; its origin is disclosed in the UI. Small requests and polling still use Next.js.
- Deployers do not need to set `SEEDANCE_API_KEY` on Vercel. Generations use each user's own Volcengine Ark account and quota.

A locally stored key can still be read by a malicious browser extension or through XSS. Follow your organization's security policy when using a company or team key. If that policy forbids sending the key through a public site's proxy, self-host the app instead. Do not enter a key on an untrusted site or device.

## Features

- Text-to-video and reference-image generation: up to 10 images in the app; up to 9 reference images for the Seedance 2.0 family.
- Four official model profiles, plus an optional custom Volcengine Ark Endpoint ID.
- Resolution, aspect ratio, and duration options that adapt to the selected model and image mode.
- Reference images become Data URLs in the browser, without using the deployer's Vercel Blob quota.
- Responsive mobile layout, touch reordering, and retries after network interruptions.
- Installable PWA, task recovery, video sharing, and open/download fallbacks.
- Chinese by default, with an English interface option.
- Server-side API routes for validation, basic rate limiting, and proxying requests to Volcengine Ark.

## Run locally

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

Open `http://localhost:3000`, enter your key in the “Volcengine Ark API Key” area at the top of the page, and save it to start generating.

You do not need to put a Seedance key in `.env.local`. The example file only documents that user API keys are not stored in deployment configuration.

## Environment variables

This version does not require `SEEDANCE_API_KEY`, `APP_ACCESS_PASSWORD`, `SESSION_SECRET`, or `BLOB_READ_WRITE_TOKEN`. Enter real API keys only in the browser settings. Do not place them in `.env`, source code, or Git commits.

## How to use

1. Paste your Volcengine Ark Seedance API key into the settings area and select “Save key”.
2. Choose a model and generation mode, then set a supported resolution, aspect ratio, and duration. The duration range depends on the selected model profile.
3. Optionally add up to 10 PNG, JPEG, or WebP reference images. Default: 3 MB per image and combined. With the optional Cloudflare image proxy: 15 MB per image / 45 MB combined, without recompression. Follow the displayed limits and the model's actual capabilities.
4. Expand “Actual submitted prompt” to review the appended instructions and character count, then select “Generate video”. The browser polls the task status and progressively backs off after network errors or rate limits. On the same device, you can refresh the page and resume an unfinished task.
5. When the video is ready, preview, open, download, or share it. The result URL may expire according to Volcengine Ark's policy, so save the video promptly.

### Models and parameters

| Model | Duration allowed by this app | Resolution allowed by this app | Reference-image limit |
| --- | --- | --- | --- |
| Seedance 2.5 | 4-30 seconds | 480p / 720p / 1080p | App limit: 10 |
| Seedance 2.0 | 4-15 seconds | 480p / 720p / 1080p / 4K | 9 |
| Seedance 2.0 Fast | 4-15 seconds | 480p / 720p | 9 |
| Seedance 2.0 Mini | 4-15 seconds | 480p / 720p | 9 |

These are the app's validation profiles. They do not guarantee that your account can access a model or that every parameter combination will succeed. Advanced settings let you enter your own `ep-…` Endpoint ID and select the profile that matches the model deployed behind it. The profile only controls validation in this app; it cannot verify the Endpoint's actual model or your authorization. Official models use their Model IDs directly, not a fixed Endpoint belonging to the project author.

Image modes are regular reference (zero to the model's limit; zero images means text-to-video), ordered reference (at least two images, with order described by prompt assistance), native first frame (exactly one image), and native first and last frames (exactly two images). Ordered references are still sent as `reference_image`; native frames use the Volcengine `first_frame` and `last_frame` roles. Seedance 2.5 requires the `adaptive` ratio for native first-frame and first/last-frame modes. Camera, motion intensity, and consistency settings are **prompt assistance**, not native model parameters. The “Generate audio” switch sends `generate_audio` to the API.

4K output may use HEVC or 10-bit encoding, which some browsers cannot preview, but the file can still be downloaded. Default uploads allow 3 MB per image and combined, with a 4,000,000-byte serialized request limit. The optional image proxy allows 15 MB per image / 45 MB combined (file sizes use MiB). The final prompt is limited to 4,000 characters. Changing models adjusts incompatible parameters with a notice, without deleting or reordering images.

## Install on mobile

In a supported mobile browser, use “Install app” or “Add to Home Screen” to install the PWA. The key stays local to that device's browser or PWA. If the installed app does not show your saved key, enter it there again. You will also need to re-enter it after switching devices or clearing local data.

## Deploy to Vercel

1. Connect the repository to Vercel.
2. Do not add a deployer-owned Seedance API key, access password, or session secret.
3. Deploy and open your domain. Each user enters their own key in the app.

Vercel hosts the frontend and a lightweight API proxy. Public routes have basic per-instance IP rate limiting. For stronger protection on a public deployment, add a WAF, shared rate-limit storage, or an access gateway in front of Vercel.

### Optional: original images up to 15 MB

Deploy the included Worker to your own Cloudflare account, set `NEXT_PUBLIC_SEEDANCE_WORKER_ORIGIN`, and rebuild Vercel. Users still enter only their own Ark key. No Blob/R2 storage is required; all visitors share the deployer's Worker allowance.

See the [deployment and verification guide](docs/cloudflare-image-proxy.md). **Validate the Free plan CPU budget, 15 MB images, and Ark compatibility in Preview before enabling Production.** Local tests do not certify deployed free-tier performance. Without configuration, the original small-image path remains active.

**Hosted-site status (2026-09-23):** The image Worker is deployed and its CORS preflight passed. The public site is not configured to use it yet, so its displayed default small-image limit still applies. A real 15 MB generation remains unverified.

## Request flow

```text
Browser / PWA
  ├─ localStorage: the user's Seedance API key
  ├─ local reference-image Data URLs
  └─ x-seedance-api-key request header
          ↓
       Next.js route handlers
          ├─ IP rate limiting and input validation
          └─ request-scoped Seedance provider (no deployer key)
          ↓
       Volcengine Ark Seedance API
```

With the optional proxy enabled, large requests go `Browser → Cloudflare Worker (streamed validation) → Ark`, bypassing Vercel's large request ingress. Task polling still uses the flow above.

## Security notes

- API keys are excluded from URLs, error messages, task-recovery objects, and server-side persistence.
- Active task records in the browser contain the task ID, status, parameters, and a SHA-256 fingerprint of the current key, never the raw key. Switching to another key pauses polling but keeps the task ID; switching back resumes it. Explicitly clearing the key also clears active task records.
- The provider accepts only the key supplied with the current request and redacts sensitive details from upstream errors.
- Next.js returns a basic CSP, and the project does not load third-party scripts.
- Reference images are not uploaded to the deployer's Blob storage. Server validation and request-size limits constrain browser Data URLs.

## Verify

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Official API documentation

- [Create a video generation task](https://docs.volcengine.com/docs/82379/1520757?lang=zh)
- [Query a video generation task](https://docs.volcengine.com/docs/82379/1521309?lang=zh)

## Live API validation status

Automated tests use mocked Volcengine Ark responses to check request construction, parameter validation, error classification, task recovery, and UI states. They are **not** proof of a successful generation with a real account. As of 2026-09-21, the full combinations of image modes, resolutions, aspect ratios, and audio settings for all four models remain **unverified** against live accounts. Actual availability also depends on account authorization, model release status, Endpoint configuration, and upstream policies. Try one short, low-cost video before generating in bulk.

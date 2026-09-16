# Seedance Studio 极简视频 MVP 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一个中文单页：输入提示词与可选参考图后，使用服务器端 API Key 创建 Seedance 任务、轮询并展示生成视频。

**Architecture:** 浏览器将提示词和可选图片 data URL 提交给内部 `/api/generate`；Route Handler 验证输入后调用仅限服务端的 `SeedanceProvider`。Provider 使用经官方文档核验的 Ark REST 端点，按是否有图片选择文生或图生的默认模型；浏览器轮询 `/api/task/[id]` 至完成并直接显示视频 URL。

**Tech Stack:** Next.js App Router、React、TypeScript、Tailwind CSS、Vitest。

**Spec:** `docs/superpowers/specs/2026-09-15-seedance-studio-design.md`

## Global Constraints

- 所有界面与错误文案使用中文；只保留提示词、参考图、生成、状态和结果。
- `SEEDANCE_API_KEY` 只在服务器读取，绝不出现在浏览器、响应、日志或错误消息中。
- 使用官方 Ark `POST /api/v3/contents/generations/tasks` 和 `GET /api/v3/contents/generations/tasks/{id}` 接口。
- 参考图仅允许 PNG、JPEG、WebP data URL，最大 8 MB；不建立公共上传或持久化存储。
- 先写并运行失败测试，再写最小实现；完成时运行 lint、typecheck、test 和 build。

---

### Task 1: 测试与规范化 Provider

**Files:**
- Create: `vitest.config.ts`
- Create: `tests/seedance-provider.test.ts`
- Modify: `package.json`, `src/lib/video/types.ts`, `src/lib/video/providers/seedance.ts`

**Interfaces:**
- Produces: `SeedanceProvider.createTask(input)` 和 `getTask(taskId)`，仅返回标准化任务形态。

- [ ] **Step 1:** 写入模拟 `fetch` 的失败测试：文生请求必须包含文本、图生请求必须包含 data URL 图像；任务响应的 `id` 映射为 `taskId`。
- [ ] **Step 2:** 运行 `npm test -- tests/seedance-provider.test.ts`，确认因实现缺失而失败。
- [ ] **Step 3:** 实现最小 Provider、状态映射和安全错误映射；读取 `SEEDANCE_API_KEY`，不记录其值。
- [ ] **Step 4:** 重跑该测试，确认通过。

### Task 2: 内部生成与任务查询 API

**Files:**
- Create: `src/app/api/generate/route.ts`
- Create: `src/app/api/task/[id]/route.ts`
- Create: `tests/api-validation.test.ts`

**Interfaces:**
- Consumes: `POST { prompt, referenceImageDataUrl? }`。
- Produces: `{ taskId }` 和 `{ taskId, status, videoUrl?, error? }`。

- [ ] **Step 1:** 写入失败测试，空提示词、超长提示词、非图片 data URL 与超过 8 MB 的图像必须得到 400。
- [ ] **Step 2:** 运行 API 校验测试并确认失败。
- [ ] **Step 3:** 实现 Route Handlers；仅返回规范化任务数据和安全错误。
- [ ] **Step 4:** 重跑 API 校验测试并确认通过。

### Task 3: 极简中文生成页

**Files:**
- Create: `src/components/studio/video-generator.tsx`
- Modify: `src/app/page.tsx`, `src/app/globals.css`

**Interfaces:**
- Consumes: `/api/generate` 与 `/api/task/[id]`。
- Produces: 参考图可选、提示词可必填、生成中不可重复提交、终态显示 `<video controls>` 与下载链接。

- [ ] **Step 1:** 写入失败的组件行为测试：空提示词禁用生成；成功返回 task ID 后开始查询；成功任务显示视频。
- [ ] **Step 2:** 运行组件测试并确认失败。
- [ ] **Step 3:** 实现单栏客户端表单与 5 秒轮询；卸载和终态时清理定时器。
- [ ] **Step 4:** 重跑组件测试并确认通过。

### Task 4: 验收、文档与提交

**Files:**
- Modify: `README.md`, `.env.local.example`

- [ ] **Step 1:** 说明仅需填写 `SEEDANCE_API_KEY`，以及首次使用前需在方舟开通对应模型。
- [ ] **Step 2:** 串行运行 `npm run lint`、`npm run typecheck`、`npm test`、`npm run build`。
- [ ] **Step 3:** 手动验证空提示词、选图预览、生成中状态和视频结果区域；不使用真实 API Key 发送付费请求。
- [ ] **Step 4:** 审查 diff 与密钥扫描，创建聚焦提交。

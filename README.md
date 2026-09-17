# Seedance Studio

一个中文默认、可切换英文的极简视频生成页面：输入提示词，可选上传参考图，等待生成后直接预览和下载视频。

## Features

- 文生视频与参考图生视频，最多 10 张参考图
- 480p / 720p / 1080p、常用画面比例、2–30 秒时长
- 移动端响应式布局、触控排序和断网重试
- 可安装的 PWA、任务恢复、视频分享与打开/下载兜底
- 中文默认，可切换 English
- 服务端代理火山方舟 API，API Key 不进入浏览器

## 当前实现

- 固定使用已配置的火山方舟 Seedance 推理接入点；页面只需配置 `SEEDANCE_API_KEY`。
- 提示词上限为 4000 字符，支持普通参考、连续关键帧和首尾帧三种生成模式。
- 支持 480p/720p/1080p、常用画面比例和 2–30 秒时长（每次 1 秒）。
- 支持最多 10 张 PNG、JPEG 或 WebP 参考图，可拖拽调整顺序，总大小不超过 8 MB。
- 页面默认中文，可通过右上角切换 English；界面不加载第三方品牌注入脚本。

## 启动

```bash
npm install
cp .env.local.example .env.local
```

在 `.env.local` 的等号后填写你的火山方舟 API Key：

```env
SEEDANCE_API_KEY=
```

可选环境变量：

```env
# 同时设置后启用访问密码；生产环境未配置时会安全拒绝受保护请求
APP_ACCESS_PASSWORD=
SESSION_SECRET=

# Vercel Blob 令牌。配置后参考图优先上传为 HTTPS URL；未配置时保留浏览器会话回退
BLOB_READ_WRITE_TOKEN=
```

然后运行：

```bash
npm run dev
```

访问 `http://localhost:3000`。

## Environment Variables

| 变量 | 必需 | 用途 |
| --- | --- | --- |
| `SEEDANCE_API_KEY` | 是 | 服务端调用火山方舟 Seedance |
| `APP_ACCESS_PASSWORD` | 否 | 访问密码（需与 `SESSION_SECRET` 一起配置） |
| `SESSION_SECRET` | 否 | 签名 HttpOnly 会话 Cookie |
| `BLOB_READ_WRITE_TOKEN` | 否 | Vercel Blob 参考图存储；未配置时使用浏览器会话回退 |

不要把真实值提交到 Git。`.env*` 已加入忽略规则；部署平台请使用 Vercel Environment Variables。

## 使用说明

- 可选择 480p/720p/1080p 分辨率、常用画面比例和 2–30 秒视频时长（每次 1 秒）；这些参数会在服务端校验后传给火山方舟。
- 可上传最多 10 张 PNG、JPEG 或 WebP 图片（总大小不超过 8 MB）；图片会作为火山方舟 `reference_image` 参考图发送。
- 首次调用前，请确保该火山方舟接入点可用；生成会按你的火山方舟账户规则计费。
- 视频任务由浏览器每 5 秒查询一次；生成成功后的视频 URL 有有效期，请及时下载。
- 生成中的任务会保存非敏感任务 ID，刷新页面后自动继续查询；任务完成或失败后会清理。
- 在支持的浏览器中，结果区可以分享、打开或下载视频。PWA 安装按钮只会在浏览器允许安装时出现；iOS Safari 会显示“分享 → 添加到主屏幕”的手动指引。

## PWA

首次打开后可按浏览器提示安装到主屏幕或桌面。应用壳与图标使用本地资源，接口、任务轮询、上传和远程视频不会被 Service Worker 缓存。离线时仍可打开基础离线页，恢复网络后继续使用。

## Deployment

1. 将仓库连接到 Vercel。
2. 在 Vercel 项目设置中添加 `SEEDANCE_API_KEY`。
3. 如需访问保护，同时添加 `APP_ACCESS_PASSWORD` 与随机长字符串 `SESSION_SECRET`。
4. 如需 URL-first 参考图上传，连接 Vercel Blob 并添加 `BLOB_READ_WRITE_TOKEN`。
5. 部署后打开分配域名，确认登录（如已启用）、上传、生成和 PWA 安装入口。

生产环境不要依赖本地 `.env.local`，也不要把 API Key 放入客户端代码。

## 安全

API Key 仅由服务器端 Route Handler 读取并转发给火山方舟。它不会发送到浏览器、写入本地存储、显示在错误信息中，或提交到 Git。启用访问保护后，登录使用签名 HttpOnly Cookie；生成接口还有单实例内存限流（多实例部署如需更强限制，可替换为共享 KV/Redis）。参考图会在服务端校验 PNG/JPEG/WebP 文件签名后再写入存储。

## Architecture

```text
Browser / PWA
  ├─ Chinese-first studio UI
  ├─ local preview + optional task recovery
  └─ /api/auth, /api/upload, /api/generate, /api/task
          ↓
       Next.js Route Handlers
          ├─ auth + rate limit
          ├─ URL-first storage (optional Vercel Blob)
          └─ Seedance provider (server-only API key)
```

## 验证

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## 官方接口依据

- [创建视频生成任务](https://docs.volcengine.com/docs/82379/1520757?lang=zh)
- [查询视频生成任务](https://docs.volcengine.com/docs/82379/1521309?lang=zh)
- [上传文件](https://docs.volcengine.com/docs/82379/1870405?lang=zh)

# Cloudflare 大图转发（可选 / Optional）

默认部署仍使用 Next.js `/api/generate`，不需要 Cloudflare。启用本通道后，浏览器将超过原 4,000,000 字节请求上限的图片请求直接发送到你部署的 Worker，绕过 Vercel Function 的入口限制。小图、纯文本和任务查询仍走原来的 Next.js 接口。

## 当前能力与验证边界

- 单张最多 **15 MiB**（15 × 1024 × 1024 字节），合计最多 **45 MiB**；界面简写为 MB。
- 原有模型图片数量、首尾帧、时长、分辨率校验保留。应用允许的大小不代表火山模型必然支持；上游拒绝仍显示实际错误。
- 不压缩、不缩放图片；不创建 R2 / Blob / KV，不保存图片或 API Key。Worker 仅临时转发当前用户的 Key。
- 免费账户的 100 MB 请求体上限足以覆盖本协议，但 **Workers Free 每请求 10 ms CPU 仍需线上测试**。本地大图测试及 dry-run 无法证明免费套餐在所有图片、手机网络和并发下稳定运行。不要为修复 CPU 超限而取消图片内容校验。
- 不承诺 10 张 15 MB 同时上传：总计仍以 45 MiB 为限。

## 部署

Worker 工具需要 Node.js 22 或更新版本。在项目根目录执行：

```bash
npm ci
npm run worker:build
npm run worker:test
npx wrangler login
```

1. 使用**你自己的 Cloudflare 账号**登录。不要提供任何用户的 Seedance Key 给部署工具。
2. 修改 `workers/seedance-proxy/wrangler.jsonc` 中的 `ALLOWED_ORIGINS` 为你的网站源地址（协议 + 域名，无路径、无尾部斜杠），多个地址以逗号分隔。当前默认是 `https://seedance-studio-five.vercel.app`。预览站点需逐个明确添加，不要使用 `*`。
3. `GENERATION_LIMITER.namespace_id` 是自行选定的正整数字符串；如果账号其他 Worker 已使用 `1001`，请改为未占用的值，避免共享计数器。
4. 执行 `npm run worker:deploy`，记录输出的 `https://seedance-image-proxy.<你的子域>.workers.dev` 地址。此命令会真实发布到你的账号。
5. 在 Vercel 的测试/Preview 环境增加下面的**公开地址变量**，重新构建部署：

```dotenv
NEXT_PUBLIC_SEEDANCE_WORKER_ORIGIN=https://seedance-image-proxy.YOUR-SUBDOMAIN.workers.dev
```

变量只能是 HTTPS 源地址，不能携带账号密码、路径、查询参数或 Key。浏览器会把当前用户的 Key 临时发给此地址，因此**只配置你控制和信任的 Worker**。修改变量后必须重新构建；不会要求用户填写 Cloudflare 账号。

先在 Preview 站点测试一张 15 MB 图片的实际生成与后续查询（会消耗测试者自己的火山额度），检查 Worker CPU 超限、网络可达性、上游大小限制。验证通过后再把同一变量添加到 Production 并重新部署。单张通过后，还需验证多图的总量边界。若免费 CPU 不足，先移除此变量并重新部署以恢复默认小图通道；不要声称免费大图已上线。

无需 `SEEDANCE_API_KEY`、`BLOB_READ_WRITE_TOKEN`、`APP_ACCESS_PASSWORD` 或 `SESSION_SECRET`。Cloudflare 登录凭据由 Wrangler 管理，不写入仓库。

## 验证与安全边界

```bash
npm test
npm run lint
npm run typecheck
npm run build
npm run worker:build
npm run worker:test
```

- Worker 仅开放固定 `/api/generate` POST，固定转发北京 Ark 创建任务接口；禁止任意目标 URL和跟随上游重定向。
- 小体积 JSON 元数据在前，图片 Base64 依次在后。按声明长度逐段验证图片类型、文件头、Base64、单张/合计大小、截断和尾随内容，并流式构造 Ark JSON。不会解析整段大图 JSON 或把图片整体解码到内存。
- 使用 Cloudflare `FixedLengthStream` 为上游提供准确 Content-Length。浏览器取消上传和超时会停止读取；不自动重试创建任务，以免重复计费。
- CORS 只允许列出的站点，但 **Origin 可以被非浏览器客户端伪造，CORS 不是身份认证**。
- Cloudflare 原生限流绑定以可信入口 IP 为键，默认每分钟 3 次创建请求；缺少绑定时拒绝服务。限流按 Cloudflare 节点计数，并非全球精确额度或防 DDoS 保证；共享出口用户也共享限制。请求仍会计入账号 Worker 配额。
- 应用不记录请求体、Key、图片；Worker Observability 默认关闭。避免在平台另开会捕获请求内容的自定义日志或追踪。正常响应和错误均 `no-store`；复用既有上游错误脱敏。
- 手机选取多张大图仍消耗浏览器内存；45 MiB 是传输上限，不是低内存手机的性能保证。

## English deployment summary

This optional Worker streams large image requests directly from the browser to Ark. Small requests and task polling stay on Next.js. Limits: **15 MiB per image / 45 MiB combined**; model-specific counts and all generation parameter checks still apply. No object storage, image recompression, or server-side key persistence.

With Node.js 22+, run `npm ci`, `npm run worker:test`, and `npx wrangler login`. The runtime test uses workerd with a local Ark stub and creates no real video jobs. Set the exact website origins in `workers/seedance-proxy/wrangler.jsonc`, then run `npm run worker:deploy`. Set `NEXT_PUBLIC_SEEDANCE_WORKER_ORIGIN` to your own Worker's HTTPS origin in a Vercel Preview environment and rebuild. Users continue to enter only their own Ark API key.

**Do not enable production until real 15 MiB and multi-image requests pass.** The Free plan's 10 ms CPU budget, connectivity, and Ark's own input limits require deployed testing; local tests do not certify these. Removing the variable and rebuilding restores the default route. Failed/ambiguous submissions are never automatically retried; check Ark tasks before resubmitting to avoid duplicate charges.

The Worker has a fixed upstream, strict CORS, streamed validation, bounded responses, and a native per-IP rate limiter. CORS is not authentication, and the limiter is per Cloudflare location rather than a global billing cap. All visitors share the deployer's Worker allowance; video charges use each visitor's Ark account. Self-hosters deploy to their own Cloudflare account.

## 官方参考 / Official references

- [Vercel 请求大小限制与直传建议](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions)
- [Cloudflare Workers 限制](https://developers.cloudflare.com/workers/platform/limits/)
- [FixedLengthStream](https://developers.cloudflare.com/workers/runtime-apis/streams/transformstream/)
- [Cloudflare Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)

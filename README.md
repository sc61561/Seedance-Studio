# Seedance Studio

Seedance Studio 是一个中文优先、可安装到桌面或手机的极简 Seedance 视频生成界面。用户输入提示词、选择输出参数并添加参考图即可生成视频。

## BYOK 模式

本项目面向开源和公开 Vercel 部署，采用 Bring Your Own Key（BYOK）：

- 每个用户在页面设置中输入自己的火山方舟 Seedance API Key。
- API Key 默认隐藏，可保存、修改或清除。
- API Key 仅保存在当前设备浏览器的 `localStorage` 中，不写入数据库、任务记录、URL、日志或 GitHub。
- 生成和任务查询时，浏览器通过 `x-seedance-api-key` 请求头把当前 Key 临时发送给 Next.js API Route；服务端只在当前请求内转发给火山方舟，请求结束后不持久化。
- 部署者不需要、也不应该在 Vercel 配置 `SEEDANCE_API_KEY`。用户生成消耗的是自己的火山方舟账户额度。

浏览器本地保存的 Key 仍可能被该设备上的恶意扩展或 XSS 读取，请只在可信设备使用，不要把 Key 分享给他人。

## Features

- 文生视频与参考图生视频，最多 10 张参考图
- 480p / 720p / 1080p、常用画面比例、2–30 秒时长
- 参考图只在浏览器本地转为 Data URL，不依赖部署者的 Vercel Blob 配额
- 移动端响应式布局、触控排序和断网重试
- 可安装 PWA、任务恢复、视频分享与打开/下载兜底
- 中文默认，可切换 English
- 服务端 API Route 负责格式校验、限流和火山方舟代理

## 本地启动

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

打开 `http://localhost:3000`，在页面顶部的“火山方舟 API Key”设置区域输入自己的 Key，然后保存即可开始生成。

`.env.local` 不需要填写 Seedance Key。`.env.local.example` 仅用于说明：部署端不保存用户的 API Key。

## 环境变量

当前版本不需要 `SEEDANCE_API_KEY`、`APP_ACCESS_PASSWORD`、`SESSION_SECRET` 或 `BLOB_READ_WRITE_TOKEN`。真实 API Key 只在浏览器设置中输入，不要写入 `.env`、源代码或提交到 Git。

## 使用说明

1. 在顶部设置区域粘贴自己的火山方舟 Seedance API Key，点击“保存 Key”。
2. 输入提示词，选择模型支持的分辨率、画面比例和 2–30 秒时长。
3. 可添加最多 10 张 PNG、JPEG 或 WebP 参考图。图片只在当前浏览器读取为 Data URL，单张及总大小不超过 3 MB。
4. 点击“生成视频”。浏览器会每 5 秒查询一次任务状态，刷新页面后可在同一设备继续查询未完成任务。
5. 生成完成后可直接预览、打开、下载或分享视频。视频 URL 有效期由火山方舟接口决定，请及时保存。

## PWA 与手机使用

在支持的浏览器中选择“安装应用”或“添加到主屏幕”即可使用手机端 PWA。API Key 保存在该手机浏览器中；换设备或清理浏览器数据后需要重新输入。

## Vercel 部署

1. 将仓库连接到 Vercel。
2. 不添加任何部署端 Seedance API Key、访问密码或会话密钥。
3. 直接部署并打开域名，用户在页面中输入自己的 Key 即可使用。

Vercel 只承载前端和轻量 API Proxy。公开接口仍有单实例 IP 限流；如果需要更强的公网防滥用能力，可在 Vercel 前再增加 WAF、共享限流存储或访问网关。

## Architecture

```text
Browser / PWA
  ├─ localStorage: 用户自己的 Seedance API Key
  ├─ 本地参考图 Data URL
  └─ x-seedance-api-key 请求头
          ↓
       Next.js Route Handlers
          ├─ IP 限流与输入校验
          └─ 请求级 Seedance provider（不读取部署端 Key）
          ↓
       火山方舟 Seedance API
```

## 安全检查

- API Key 不进入 URL、错误文本、任务恢复对象或服务端持久化。
- provider 只接受当前请求传入的 Key，并对上游错误详情做脱敏。
- Next.js 返回基础 CSP，项目不加载第三方脚本。
- 参考图不上传到部署者 Blob；浏览器 Data URL 大小受到服务端校验和请求体上限约束。

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

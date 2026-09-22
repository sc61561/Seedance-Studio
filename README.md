<p align="right"><strong>中文</strong> | <a href="./README.en.md">English</a></p>

<div align="center">

<a href="https://seedance-studio-five.vercel.app/">
  <img src="public/icons/icon-192.png" alt="Seedance Studio 图标，点击打开在线版" width="96" height="96">
</a>

<h1>Seedance Studio</h1>

<p>把自己的火山方舟 API Key 带进来，从提示词和参考图直接生成视频。</p>

<h3><a href="https://seedance-studio-five.vercel.app/">打开在线版 ↗</a></h3>

<p><a href="#本地运行">本地运行</a> &nbsp;&nbsp; <a href="#手机端安装">手机端安装</a></p>

</div>

Seedance Studio 是中文优先的视频生成工作台。无需配置部署者的 Key，在浏览器中保存自己的 Key，即可使用火山方舟 Seedance 生成、预览和下载视频。

## BYOK 模式

本项目面向开源和公开 Vercel 部署，采用 Bring Your Own Key（BYOK）：

- 每个用户在页面设置中输入自己的火山方舟 Seedance API Key。
- API Key 默认隐藏，可保存、修改或清除。
- API Key 仅保存在当前设备浏览器的 `localStorage` 中，不写入数据库、任务记录、URL、日志或 GitHub。
- 生成和任务查询时，浏览器通过 `x-seedance-api-key` 请求头把当前 Key 临时发送给**当前站点的 Next.js/Vercel 代理**；服务端只在当前请求内转发给火山方舟，应用代码不记录、不持久化该 Key。
- 部署者不需要、也不应该在 Vercel 配置 `SEEDANCE_API_KEY`。用户生成消耗的是自己的火山方舟账户额度。

浏览器本地保存的 Key 仍可能被该设备上的恶意扩展或 XSS 读取。公司或团队的 Key 应遵守所属组织的安全政策；如政策不允许把 Key 交给公开站点代理，请自行部署。不要在不可信站点或设备输入 Key。

## 功能概览

- 文生视频与参考图生视频，产品上限 10 张参考图；2.0 系列的参考模式最多 9 张
- 四个官方模型档案，以及可选的自定义火山方舟 Endpoint ID
- 随所选模型和图片模式变化的分辨率、画面比例与时长
- 参考图只在浏览器本地转为 Data URL，不依赖部署者的 Vercel Blob 配额
- 移动端响应式布局、触控排序和断网重试
- 可安装 PWA、任务恢复、视频分享与打开/下载兜底
- 中文默认，可切换 English
- 服务端 API Route 负责格式校验、限流和火山方舟代理

## 本地运行

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
2. 选择模型、生成模式和其支持的分辨率、画面比例、时长；时长以所选模型档案为准。
3. 可添加最多 10 张 PNG、JPEG 或 WebP 参考图。图片只在当前浏览器读取为 Data URL，单张及总大小不超过 3 MB。
4. 可展开“实际提交提示词”核对追加的描述和字符数，随后点击“生成视频”。浏览器会查询任务状态；网络故障或限流时会逐步延长重试间隔。刷新页面后可在同一设备继续查询未完成任务。
5. 生成完成后可直接预览、打开、下载或分享视频。视频 URL 有效期由火山方舟接口决定，请及时保存。

### 模型与参数

| 模型 | 本应用时长范围 | 本应用分辨率 | 参考图上限 |
| --- | --- | --- | --- |
| Seedance 2.5 | 4-30 秒 | 480p / 720p / 1080p | 产品上限 10 张 |
| Seedance 2.0 | 4-15 秒 | 480p / 720p / 1080p / 4K | 9 张 |
| Seedance 2.0 Fast | 4-15 秒 | 480p / 720p | 9 张 |
| Seedance 2.0 Mini | 4-15 秒 | 480p / 720p | 9 张 |

这些是当前应用的校验档案，并不保证你的账户已开通对应模型或每种组合都可生成。高级选项可填写自己账户的 `ep-…` Endpoint ID，同时必须选与其实际部署模型一致的能力档案；档案只负责本应用的参数校验，不能证明 Endpoint 背后的模型或授权。官方模型会直接使用其 Model ID，不使用项目作者的固定 Endpoint。

图片模式分为普通参考（可上传 0 张至模型上限；0 张为文生视频）、顺序参考（至少 2 张，顺序由提示词辅助描述）、原生首帧（恰好 1 张）和原生首尾帧（恰好 2 张）。顺序参考的图片仍按 `reference_image` 发送；首帧和首尾帧分别使用火山原生 `first_frame` / `last_frame` 角色。2.5 的原生首帧/首尾帧必须使用 `adaptive` 比例。镜头、运动幅度和一致性属于**提示词辅助**，不是火山原生参数；“生成音频”开关则会实际发送 `generate_audio`。

4K 输出可能使用 HEVC / 10-bit 编码，部分浏览器无法直接预览，但仍可下载。图片单张及总量均不超过 3 MB，序列化生成请求不超过 4,000,000 字节；最终提示词上限为 4,000 字符。切换模型时，应用会调整不适用的参数并提示，但不会自动删除或调换参考图。

## 手机端安装

在支持的浏览器中选择“安装应用”或“添加到主屏幕”即可使用手机端 PWA。Key 保存在当前设备的浏览器或 PWA 本地；安装后若未显示已保存的 Key，请在应用内重新输入。换设备或清理数据后也需要重新输入。

## Vercel 部署

1. 将仓库连接到 Vercel。
2. 不添加任何部署端 Seedance API Key、访问密码或会话密钥。
3. 直接部署并打开域名，用户在页面中输入自己的 Key 即可使用。

Vercel 只承载前端和轻量 API Proxy。公开接口仍有单实例 IP 限流；如果需要更强的公网防滥用能力，可在 Vercel 前再增加 WAF、共享限流存储或访问网关。

## 请求链路

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
- 活跃任务记录只在浏览器保存任务编号、状态、参数和当前 Key 的 SHA-256 指纹，不保存原始 Key。切换到另一 Key 时暂停查询并保留任务编号；切回原 Key 后恢复。主动清除 Key 会同时清除活跃任务记录。
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

## 实际接口验证状态

自动化测试使用模拟的火山 API 响应，验证请求构造、参数校验、错误分类、任务恢复和界面状态；它们**不是**真实账户的成功生成证据。截至 2026-09-21，四个模型各图片模式、分辨率、画面比例和音频开关的完整组合均标记为**待验证**。实际可用性还取决于账户授权、模型发布状态、Endpoint 配置及上游策略；建议先用低成本组合做一条短片验证，再批量使用。

# Seedance Studio BYOK 改造实施计划

> **执行方式：** 测试驱动开发；每项任务先补充失败测试，再实现并运行针对性测试，最后运行完整验证。

## 目标

将公开部署的 Seedance Studio 改为 BYOK（Bring Your Own Key）：每个用户在当前浏览器中保存自己的火山方舟 API Key，客户端通过请求头临时传给 Next.js API Route，服务端仅在当前请求内调用火山方舟，不读取或保存部署端 Seedance Key。

## 约束与安全边界

- Key 使用 `localStorage` 保存，默认隐藏；不得进入 URL、任务恢复对象、日志、错误详情、React Server Component props 或任何服务端持久化。
- `/api/generate`、`/api/task/[id]` 使用 `x-seedance-api-key`，服务端为每次请求创建携带该 Key 的 provider。
- 上传接口不调用火山 API；优先在浏览器保留 Data URL 回退，避免所有用户共享部署者的 Blob 配额。若保留可选 Blob 上传，则必须由用户 Key 触发且不把 Key 持久化。
- 删除旧的 `APP_ACCESS_PASSWORD`、`SESSION_SECRET` 和登录会话体系；保留 IP 限流并覆盖所有公开 API Route。
- 增加基础 CSP，避免引入第三方脚本，降低 localStorage Key 被窃取的风险。

## 任务

### 1. 建立 BYOK 契约与失败测试

- 添加客户端 API Key 存储/读取/清除模块的测试。
- 添加服务端请求头解析、空值/控制字符/长度校验测试。
- 更新 generate、task、upload 路由测试：缺 Key 的生成与查询拒绝；合法 Key 只传给 provider；上传不依赖旧 Cookie 鉴权。
- 更新 provider 测试：构造函数必须接收当前请求 Key，禁止读取 `process.env.SEEDANCE_API_KEY`。
- 删除或重写旧密码会话测试。

### 2. 改造服务端请求链路

- 新增服务端 API Key 解析工具，返回稳定的 API 错误码，不暴露 Key。
- 修改 `SeedanceProvider` 构造函数和所有调用点，使 Key 只存在于当前请求内。
- 修改 `/api/generate`、`/api/task/[id]`，通过 `x-seedance-api-key` 调用 provider。
- 移除 `requireApiAuth`、Cookie 会话和 `/api/auth/*` 路由。
- 保留并检查生成、查询、上传的 IP 限流；不在限流 Key 中存储原始 API Key。
- 评估上传链路：默认浏览器 Data URL，部署端不再必须配置 `BLOB_READ_WRITE_TOKEN`。

### 3. 改造前端 Key 设置与生成流程

- 在设置区域添加 API Key 输入、显示/隐藏、保存、修改、清除。
- 明确显示“API Key 仅保存在当前设备浏览器中”。
- 生成、任务轮询、任务恢复和上传请求统一附加当前 Key；没有 Key 时阻止生成并给出本地化提示。
- 清除 Key 时停止轮询并清理当前活动任务，且不把 Key 写入任务存储。
- 删除登录门禁、登录/退出按钮与旧授权状态。

### 4. 配置、文档与安全策略

- 从 `.env.local.example`、README、代码和测试中删除 `SEEDANCE_API_KEY`、`APP_ACCESS_PASSWORD`、`SESSION_SECRET`。
- 保留并明确说明可选的 Blob 配置（若实现仍保留远程上传）；优先移除该依赖。
- 更新中英文 i18n 文案和错误码。
- 在 Next 配置中加入基础 CSP，并确保本地开发/视频播放/火山请求不被误拦截。

### 5. 验证

- 运行针对性 Vitest（API Key、路由、provider、组件、任务恢复）。
- 运行 `npm test`、`npm run lint`、`npm run typecheck`、`npm run build`。
- 用 `rg` 检查仓库中不存在 `process.env.SEEDANCE_API_KEY`、旧密码环境变量引用或真实 API Key 形态。
- 检查 `git diff`，确认不触碰用户已有未提交文档修改、不包含敏感文件。

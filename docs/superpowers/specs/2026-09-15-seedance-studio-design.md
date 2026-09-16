# Seedance Studio 设计说明

## 目标

构建一个中文界面的 Seedance Studio Web 应用。用户只需在服务器环境中配置
`SEEDANCE_API_KEY`，即可通过图形界面完成 Seedance 视频生成。MVP 支持文生视频、
图生视频、任务轮询、预览下载、本地历史与提示词预设。

API 密钥始终只存在于服务器环境；浏览器只访问应用内部 API 路由。

## 范围与阶段

本次只实施 Phase 1：初始化可构建、可检查的项目骨架，以及独立的视频 Provider
接口。不会在本阶段猜测或调用 Seedance API，也不会实现复杂工作室界面。

后续阶段依序实现并分别验证：官方 API 适配、最小联调页面、正式中文界面、图片
上传、轮询、预览下载、历史记录、提示词预设、模型配置、错误处理、请求校验与部署。

## 技术方案

- Next.js App Router、React、TypeScript。
- Tailwind CSS 和 shadcn/ui 作为界面基础；所有用户可见的初始文案为中文。
- Next.js Route Handlers 承担内部 API；React hooks 管理客户端交互状态。
- MVP 历史记录仅保存到浏览器 `localStorage`，不引入账号或数据库。
- 运行目标为 Node.js，后续提供 Docker 部署方式。

## 模块边界

```text
浏览器 UI
  -> /api/generate、/api/task/[id]、/api/upload
  -> 视频服务门面
  -> VideoProvider
  -> SeedanceProvider（仅服务端）
  -> Volcano Engine / Ark API
```

前端仅使用标准化的任务状态与视频结果，不依赖任何第三方响应结构。Provider 接口
定义任务创建与查询；所有 Seedance 模型 ID、请求映射、认证和响应解析都隔离在
`lib/video/providers/seedance.ts`。在编写这些映射前，必须核验最新官方文档。

Phase 1 的目录结构如下：

```text
app/
  layout.tsx
  page.tsx
components/ui/
lib/video/
  types.ts
  provider.ts
  providers/seedance.ts
.env.local.example
```

首页仅显示中文初始化状态，不调用第三方服务。

## 数据与安全

`VideoTaskState`、创建任务输入、创建任务结果和任务状态均为内部规范化 TypeScript
类型。`SEEDANCE_API_KEY` 只通过服务器端环境变量读取；不会使用 `NEXT_PUBLIC_*`，也
不会写入日志、响应、HTML、客户端存储或错误消息。

`.env.local.example` 只包含空值示例，`.env.local` 和其他私密环境文件均由 Git 忽略。
后续路由将进行服务器端参数校验，且错误对用户保持可理解但不暴露内部详情。

## 验证与完成条件

每个阶段结束时都要运行：

```bash
npm run lint
npm run typecheck
npm run build
```

并进行相应的手动验证、审查 Git diff 和密钥泄露检查。Phase 1 必须能显示中文首页，
三条命令全部通过，且 Provider 架构可被类型系统验证。完成后创建一个只包含该阶段
内容的 Git 提交。

## 非目标

MVP 不包含登录、注册、支付、积分、数据库、团队协作、复杂工作流或视频编辑器。
不在未查证官方文档的情况下假设 Seedance API 的字段、模型或上传机制。

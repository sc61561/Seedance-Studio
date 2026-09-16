# Seedance Studio

一个中文极简视频生成页面：输入提示词，可选上传参考图，等待生成后直接预览和下载视频。

## 启动

```bash
npm install
cp .env.local.example .env.local
```

在 `.env.local` 的等号后填写你的火山方舟 API Key：

```env
SEEDANCE_API_KEY=
```

然后运行：

```bash
npm run dev
```

访问 `http://localhost:3000`。

## 使用说明

- 已固定使用提供的火山方舟推理接入点；页面仅需配置 API Key。
- 可选择 480p/720p/1080p 分辨率、常用画面比例和 2–30 秒视频时长（每次 1 秒）；这些参数会在服务端校验后传给火山方舟。
- 可上传最多 10 张 PNG、JPEG 或 WebP 图片（总大小不超过 8 MB）；图片会作为火山方舟 `reference_image` 参考图发送。
- 首次调用前，请确保该火山方舟接入点可用；生成会按你的火山方舟账户规则计费。
- 视频任务由浏览器每 5 秒查询一次；生成成功后的视频 URL 有有效期，请及时下载。

## 安全

API Key 仅由服务器端 Route Handler 读取并转发给火山方舟。它不会发送到浏览器、写入本地存储、显示在错误信息中，或提交到 Git。

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

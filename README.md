# Seedance Studio

一个中文极简视频生成页面：输入提示词，可选上传一张参考图，等待生成后直接预览和下载视频。

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

- 不选参考图时，应用使用官方文生视频示例模型 `doubao-seedance-1-0-pro-250528`。
- 选择 PNG、JPEG 或 WebP 参考图（最大 8 MB）时，应用使用官方图生视频示例模型 `doubao-seedance-1-0-lite-i2v-250428`，并以 data URL 传入。
- 首次调用前，请确保已在火山方舟开通相应模型；生成会按你的火山方舟账户规则计费。
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

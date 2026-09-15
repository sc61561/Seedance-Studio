"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

import {
  aspectRatioOptions,
  defaultSeedanceModel,
  durationOptions,
  getSeedanceModel,
  resolutionOptions,
  seedanceModels,
} from "@/lib/video/models";

type VideoTaskState =
  | "idle"
  | "submitting"
  | "queued"
  | "processing"
  | "succeeded"
  | "failed";

type VideoTask = {
  taskId: string;
  status: VideoTaskState;
  videoUrl?: string;
  error?: string;
};

const maxImageBytes = 8 * 1024 * 1024;
const acceptedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export function VideoGenerator() {
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState(defaultSeedanceModel());
  const [resolution, setResolution] = useState<(typeof resolutionOptions)[number]>("720p");
  const [aspectRatio, setAspectRatio] = useState<(typeof aspectRatioOptions)[number]>("16:9");
  const [duration, setDuration] = useState<(typeof durationOptions)[number]>(5);
  const [referenceImageDataUrl, setReferenceImageDataUrl] = useState<string>();
  const [referenceImageName, setReferenceImageName] = useState<string>();
  const [task, setTask] = useState<VideoTask>({ taskId: "", status: "idle" });
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);
  const submitAbortRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);

  const stopPolling = () => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }

    pollAbortRef.current?.abort();
    pollAbortRef.current = null;
  };

  const clearReferenceImage = () => {
    setReferenceImageDataUrl(undefined);
    setReferenceImageName(undefined);
    setModel(defaultSeedanceModel());
  };

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      stopPolling();
      submitAbortRef.current?.abort();
      submitAbortRef.current = null;
    };
  }, []);

  const isGenerating = task.status === "submitting" || task.status === "queued" || task.status === "processing";

  async function handleReferenceImageChange(file: File | undefined) {
    if (!file) {
      clearReferenceImage();
      return;
    }

    if (!acceptedImageTypes.has(file.type)) {
      clearReferenceImage();
      setTask({ taskId: "", status: "failed", error: "参考图仅支持 PNG、JPEG 或 WebP 格式。" });
      return;
    }

    if (file.size > maxImageBytes) {
      clearReferenceImage();
      setTask({ taskId: "", status: "failed", error: "参考图不能超过 8 MB。" });
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      if (!isMountedRef.current) {
        return;
      }

      setReferenceImageDataUrl(dataUrl);
      setReferenceImageName(file.name);
      setTask({ taskId: "", status: "idle" });
    } catch {
      if (!isMountedRef.current) {
        return;
      }

      clearReferenceImage();
      setTask({ taskId: "", status: "failed", error: "读取参考图失败，请重新选择。" });
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isGenerating || !prompt.trim()) {
      return;
    }

    stopPolling();
    setTask({ taskId: "", status: "submitting" });
    const controller = new AbortController();
    submitAbortRef.current = controller;

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          model,
          resolution,
          aspectRatio,
          duration,
          referenceImageDataUrl,
        }),
        signal: controller.signal,
      });
      const payload = (await response.json()) as { taskId?: string; error?: string };

      if (!isMountedRef.current || controller.signal.aborted) {
        return;
      }

      if (!response.ok || !payload.taskId) {
        throw new Error(payload.error ?? "视频任务创建失败，请稍后重试。");
      }

      const nextTask = { taskId: payload.taskId, status: "queued" as const };
      setTask(nextTask);
      await pollTask(nextTask.taskId);
    } catch (error) {
      if (!isMountedRef.current || controller.signal.aborted) {
        return;
      }

      setTask({
        taskId: "",
        status: "failed",
        error: error instanceof Error ? error.message : "视频任务创建失败，请稍后重试。",
      });
    } finally {
      if (submitAbortRef.current === controller) {
        submitAbortRef.current = null;
      }
    }
  }

  function handleModelChange(nextModel: string) {
    const nextConfig = getSeedanceModel(nextModel);
    if (!nextConfig) {
      return;
    }

    setModel(nextConfig.id);
    if (!nextConfig.resolutions.some((option) => option === resolution)) {
      setResolution(nextConfig.resolutions[0]);
    }
  }

  async function pollTask(taskId: string) {
    if (!isMountedRef.current) {
      return;
    }

    const controller = new AbortController();
    pollAbortRef.current = controller;

    try {
      const response = await fetch(`/api/task/${encodeURIComponent(taskId)}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = (await response.json()) as VideoTask;

      if (!isMountedRef.current || controller.signal.aborted) {
        return;
      }

      if (!response.ok) {
        throw new Error(payload.error ?? "视频任务查询失败，请稍后重试。");
      }

      setTask(payload);
      if (payload.status === "succeeded" || payload.status === "failed") {
        stopPolling();
        return;
      }

      pollTimerRef.current = setTimeout(() => {
        if (isMountedRef.current) {
          void pollTask(taskId);
        }
      }, 5_000);
    } catch (error) {
      if (!isMountedRef.current || controller.signal.aborted) {
        return;
      }

      setTask({
        taskId,
        status: "failed",
        error: error instanceof Error ? error.message : "视频任务查询失败，请稍后重试。",
      });
      stopPolling();
    } finally {
      if (pollAbortRef.current === controller) {
        pollAbortRef.current = null;
      }
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950 px-4 py-10 text-zinc-100 sm:px-6">
      <section className="mx-auto w-full max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl shadow-black/20 sm:p-8">
        <header className="mb-8">
          <p className="text-sm font-medium text-zinc-400">Seedance Studio</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">视频生成</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            输入提示词，可选上传一张参考图，然后等待视频生成完成。
          </p>
        </header>

        <form className="space-y-6" onSubmit={handleSubmit}>
          <label className="block">
            <span className="mb-2 block text-sm font-medium">提示词</span>
            <textarea
              className="min-h-36 w-full resize-y rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm leading-6 outline-none placeholder:text-zinc-600 focus:border-zinc-400"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="请输入你想生成的视频内容"
              maxLength={2000}
              disabled={isGenerating}
              required
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium">选择模型</span>
            <select
              className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm outline-none focus:border-zinc-400 disabled:cursor-not-allowed disabled:opacity-50"
              value={model}
              onChange={(event) => handleModelChange(event.target.value)}
              disabled={isGenerating}
            >
              {seedanceModels.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <span className="mt-2 block text-xs text-zinc-500">
              四个模型均支持文生视频和单张参考图作为首帧的图生视频。
            </span>
          </label>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block">
              <span className="mb-2 block text-sm font-medium">分辨率</span>
              <select
                className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm outline-none focus:border-zinc-400 disabled:cursor-not-allowed disabled:opacity-50"
                value={resolution}
                onChange={(event) => setResolution(event.target.value as typeof resolution)}
                disabled={isGenerating}
              >
                {(getSeedanceModel(model)?.resolutions ?? resolutionOptions).map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium">画面比例</span>
              <select
                className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm outline-none focus:border-zinc-400 disabled:cursor-not-allowed disabled:opacity-50"
                value={aspectRatio}
                onChange={(event) => setAspectRatio(event.target.value as typeof aspectRatio)}
                disabled={isGenerating}
              >
                {aspectRatioOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 flex items-center justify-between text-sm font-medium">
                <span>视频时长</span>
                <span className="text-zinc-400">{duration} 秒</span>
              </span>
              <input
                className="w-full accent-white disabled:cursor-not-allowed disabled:opacity-50"
                type="range"
                min={5}
                max={10}
                step={5}
                value={duration}
                onChange={(event) => setDuration(Number(event.target.value) as typeof duration)}
                disabled={isGenerating}
                aria-label="视频时长"
              />
              <span className="mt-1 flex justify-between text-xs text-zinc-500">
                <span>{durationOptions[0]} 秒</span>
                <span>{durationOptions[durationOptions.length - 1]} 秒</span>
              </span>
            </label>
          </div>

          <label className="block">
            <span className="mb-2 block text-sm font-medium">参考图（可选）</span>
            <input
              className="block w-full cursor-pointer rounded-xl border border-dashed border-zinc-700 bg-zinc-950 px-3 py-3 text-sm text-zinc-300 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-800 file:px-3 file:py-2 file:text-sm file:text-zinc-100 hover:file:bg-zinc-700"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => void handleReferenceImageChange(event.target.files?.[0])}
              disabled={isGenerating}
            />
            <span className="mt-2 block text-xs text-zinc-500">
              {referenceImageName ? `已选择：${referenceImageName}` : "支持 PNG、JPEG、WebP，最大 8 MB"}
            </span>
          </label>

          <button
            className="w-full rounded-xl bg-white px-4 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
            type="submit"
            disabled={!prompt.trim() || isGenerating}
          >
            {isGenerating ? "正在生成…" : "生成视频"}
          </button>
        </form>

        <section className="mt-8 border-t border-zinc-800 pt-6" aria-live="polite">
          <h2 className="text-sm font-medium">生成结果</h2>
          {task.status === "idle" && <p className="mt-2 text-sm text-zinc-500">尚未提交任务。</p>}
          {isGenerating && (
            <p className="mt-2 text-sm text-zinc-300">
              {task.status === "submitting" ? "正在提交任务…" : "视频正在生成，请耐心等待…"}
            </p>
          )}
          {task.status === "failed" && <p className="mt-2 text-sm text-red-300">{task.error}</p>}
          {task.status === "succeeded" && task.videoUrl && (
            <div className="mt-4 space-y-3">
              <video className="w-full rounded-xl bg-black" controls src={task.videoUrl}>
                当前浏览器不支持视频播放。
              </video>
              <a
                className="inline-flex rounded-lg border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800"
                href={task.videoUrl}
                target="_blank"
                rel="noreferrer"
                download
              >
                下载视频
              </a>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

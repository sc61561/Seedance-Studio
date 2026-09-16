"use client";

import type { DragEvent, FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleAlert,
  Clapperboard,
  Download,
  FileImage,
  Film,
  GripVertical,
  ImagePlus,
  LoaderCircle,
  Move,
  Play,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import {
  buildFinalPrompt,
  maxFinalPromptLength,
  resolveGenerationMode,
  type CameraMode,
  type ConsistencyLevel,
  type GenerationMode,
  type MotionLevel,
} from "@/lib/video/prompt-compiler";
import { reorderReferenceImages, type ReferenceImage } from "@/lib/video/reference-images";
import {
  aspectRatioOptions,
  defaultDuration,
  defaultSeedanceModel,
  maxDuration,
  minDuration,
  resolutionOptions,
} from "@/lib/video/models";

type VideoTaskState = "idle" | "submitting" | "queued" | "processing" | "succeeded" | "failed";
type VideoTask = { taskId: string; status: VideoTaskState; videoUrl?: string; error?: string };

const maxImageBytes = 8 * 1024 * 1024;
const maxReferenceImages = 10;
const acceptedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export function VideoGenerator() {
  const [prompt, setPrompt] = useState("");
  const [resolution, setResolution] = useState<(typeof resolutionOptions)[number]>("720p");
  const [aspectRatio, setAspectRatio] = useState<(typeof aspectRatioOptions)[number]>("16:9");
  const [duration, setDuration] = useState(defaultDuration);
  const [generationMode, setGenerationMode] = useState<GenerationMode>("keyframes");
  const [cameraMode, setCameraMode] = useState<CameraMode>("auto");
  const [motionLevel, setMotionLevel] = useState<MotionLevel>("auto");
  const [consistencyLevel, setConsistencyLevel] = useState<ConsistencyLevel>("high");
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const [draggedImageId, setDraggedImageId] = useState<string>();
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
  const modeHint = generationMode === "first-last" && referenceImages.length < 2
    ? "建议上传至少 2 张图片作为首尾帧。"
    : generationMode === "keyframes" && referenceImages.length < 2
      ? "建议上传至少 2 张图片以建立时间顺序。"
      : generationMode === "keyframes"
        ? "连续关键帧模式下，图片顺序代表视频中的时间顺序，可拖拽调整。"
        : "图片顺序会按当前编号发送给 Seedance。";

  async function handleReferenceImageChange(files: FileList | null) {
    const selectedFiles = Array.from(files ?? []);
    if (selectedFiles.length === 0) return;
    if (referenceImages.length + selectedFiles.length > maxReferenceImages) {
      setTask({ taskId: "", status: "failed", error: `参考图最多可上传 ${maxReferenceImages} 张。` });
      return;
    }
    if (selectedFiles.some((file) => !acceptedImageTypes.has(file.type))) {
      setTask({ taskId: "", status: "failed", error: "参考图仅支持 PNG、JPEG 或 WebP 格式。" });
      return;
    }
    const existingBytes = referenceImages.reduce((total, image) => total + dataUrlByteLength(image.dataUrl), 0);
    const selectedBytes = selectedFiles.reduce((total, file) => total + file.size, 0);
    if (existingBytes + selectedBytes > maxImageBytes) {
      setTask({ taskId: "", status: "failed", error: "参考图总大小不能超过 8 MB。" });
      return;
    }
    try {
      const nextImages = await Promise.all(
        selectedFiles.map(async (file, index) => ({
          id: createReferenceImageId(index),
          name: file.name,
          dataUrl: await readFileAsDataUrl(file),
        })),
      );
      if (!isMountedRef.current) return;
      setReferenceImages((images) => [...images, ...nextImages]);
      setTask({ taskId: "", status: "idle" });
    } catch {
      if (isMountedRef.current) {
        setTask({ taskId: "", status: "failed", error: "读取参考图失败，请重新选择。" });
      }
    }
  }

  function removeReferenceImage(id: string) {
    setReferenceImages((images) => images.filter((image) => image.id !== id));
    setTask({ taskId: "", status: "idle" });
  }

  function handleImageDrop(event: DragEvent<HTMLLIElement>, targetId: string) {
    event.preventDefault();
    if (draggedImageId) {
      setReferenceImages((images) => reorderReferenceImages(images, draggedImageId, targetId));
    }
    setDraggedImageId(undefined);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isGenerating || !prompt.trim()) return;
    stopPolling();
    setTask({ taskId: "", status: "submitting" });
    const controller = new AbortController();
    submitAbortRef.current = controller;
    const effectiveGenerationMode = resolveGenerationMode(generationMode, referenceImages.length);
    const finalPrompt = buildFinalPrompt({
      userPrompt: prompt,
      referenceImageCount: referenceImages.length,
      generationMode: effectiveGenerationMode,
      cameraMode,
      motionLevel,
      consistencyLevel,
    });
    if (finalPrompt.length > maxFinalPromptLength) {
      if (submitAbortRef.current === controller) submitAbortRef.current = null;
      setTask({
        taskId: "",
        status: "failed",
        error: `当前提示词加控制指令后不能超过 ${maxFinalPromptLength} 个字符，请缩短提示词。`,
      });
      return;
    }
    const imagesForGeneration = effectiveGenerationMode === "first-last" && referenceImages.length > 2
      ? [referenceImages[0], referenceImages[referenceImages.length - 1]]
      : referenceImages;
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          prompt: finalPrompt,
          model: defaultSeedanceModel(),
          resolution,
          aspectRatio,
          duration,
          referenceImageDataUrls: imagesForGeneration.map((image) => image.dataUrl),
        }),
      });
      const payload = (await response.json()) as { taskId?: string; error?: string };
      if (!isMountedRef.current || controller.signal.aborted) return;
      if (!response.ok || !payload.taskId) {
        throw new Error(payload.error ?? "视频任务创建失败，请稍后重试。");
      }
      const nextTask = { taskId: payload.taskId, status: "queued" as const };
      setTask(nextTask);
      await pollTask(nextTask.taskId);
    } catch (error) {
      if (!isMountedRef.current || controller.signal.aborted) return;
      setTask({
        taskId: "",
        status: "failed",
        error: error instanceof Error ? error.message : "视频任务创建失败，请稍后重试。",
      });
    } finally {
      if (submitAbortRef.current === controller) submitAbortRef.current = null;
    }
  }

  async function pollTask(taskId: string) {
    if (!isMountedRef.current) return;
    const controller = new AbortController();
    pollAbortRef.current = controller;
    try {
      const response = await fetch(`/api/task/${encodeURIComponent(taskId)}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = (await response.json()) as VideoTask;
      if (!isMountedRef.current || controller.signal.aborted) return;
      if (!response.ok) throw new Error(payload.error ?? "视频任务查询失败，请稍后重试。");
      setTask(payload);
      if (payload.status === "succeeded" || payload.status === "failed") {
        stopPolling();
        return;
      }
      pollTimerRef.current = setTimeout(() => {
        if (isMountedRef.current) void pollTask(taskId);
      }, 5_000);
    } catch (error) {
      if (!isMountedRef.current || controller.signal.aborted) return;
      setTask({
        taskId,
        status: "failed",
        error: error instanceof Error ? error.message : "视频任务查询失败，请稍后重试。",
      });
      stopPolling();
    } finally {
      if (pollAbortRef.current === controller) pollAbortRef.current = null;
    }
  }

  return (
    <main className="studio-shell min-h-screen px-4 py-5 text-stone-100 sm:px-6 sm:py-8 lg:px-10">
      <div className="mx-auto w-full max-w-[1440px]">
        <header className="studio-topbar mb-8 flex items-center justify-between gap-4 pb-5 sm:mb-12">
          <div className="flex items-center gap-3">
            <div className="studio-mark flex size-9 items-center justify-center rounded-xl" aria-hidden="true">
              <Clapperboard className="size-4" strokeWidth={1.8} />
            </div>
            <div>
              <p className="studio-eyebrow">SEEDANCE / STUDIO</p>
              <p className="mt-1 text-xs text-stone-500">视频创作工作台</p>
            </div>
          </div>
          <div className="studio-status hidden items-center gap-2 sm:flex">
            <span className="studio-status-dot" aria-hidden="true" />
            <span>ARK API 已配置</span>
          </div>
        </header>

        <div className="mb-8 max-w-3xl sm:mb-10">
          <p className="studio-eyebrow mb-3">AI VIDEO GENERATOR</p>
          <h1 className="studio-title">把一个想法，变成一段镜头。</h1>
          <p className="mt-4 max-w-xl text-sm leading-6 text-stone-400 sm:text-base">
            用提示词和参考素材定义画面，剩下的交给 Seedance。
          </p>
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.08fr)_minmax(370px,0.92fr)] xl:gap-8">
          <section className="studio-panel overflow-hidden">
            <div className="border-b border-stone-800/80 px-5 py-5 sm:px-7">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="studio-index">01 / INPUT</p>
                  <h2 className="mt-2 text-lg font-medium tracking-tight text-stone-100">生成设定</h2>
                </div>
                <Sparkles className="size-5 text-lime-300/80" strokeWidth={1.6} aria-hidden="true" />
              </div>
            </div>

            <form className="space-y-0" onSubmit={handleSubmit}>
              <div className="studio-form-section">
                <div className="mb-3 flex items-end justify-between gap-4">
                  <label className="studio-label" htmlFor="video-prompt">提示词</label>
                  <span className="studio-counter" aria-live="polite">{prompt.length} / {maxFinalPromptLength}</span>
                </div>
                <textarea
                  id="video-prompt"
                  className="studio-textarea min-h-44"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="请输入你想生成的视频内容"
                  maxLength={maxFinalPromptLength}
                  disabled={isGenerating}
                  required
                />
                <p className="mt-2 text-xs text-stone-500">越具体的动作和镜头描述，越容易得到稳定结果。</p>
              </div>

              <div className="studio-model-row flex items-center justify-between gap-4 px-5 py-4 sm:px-7">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="studio-model-icon flex size-9 shrink-0 items-center justify-center rounded-lg" aria-hidden="true">
                    <Film className="size-4" strokeWidth={1.7} />
                  </div>
                  <div className="min-w-0">
                    <p className="studio-label">已配置模型</p>
                    <p className="mt-1 truncate text-sm text-stone-200">Seedance 视频生成</p>
                  </div>
                </div>
                <span className="studio-chip shrink-0"><Check className="size-3" /> 火山方舟接入点已配置</span>
              </div>

              <div className="studio-form-section border-t border-stone-800/80">
                <div className="mb-4 flex items-center justify-between gap-4">
                  <div>
                    <p className="studio-index">02 / OUTPUT</p>
                    <h2 className="mt-2 text-lg font-medium tracking-tight text-stone-100">输出设置</h2>
                  </div>
                  <SlidersHorizontal className="size-5 text-stone-500" strokeWidth={1.6} aria-hidden="true" />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <SelectField label="分辨率" value={resolution} onChange={(value) => setResolution(value as typeof resolution)} disabled={isGenerating} options={resolutionOptions} />
                  <SelectField label="画面比例" value={aspectRatio} onChange={(value) => setAspectRatio(value as typeof aspectRatio)} disabled={isGenerating} options={aspectRatioOptions} />
                </div>

                <label className="mt-5 block" htmlFor="video-duration">
                  <span className="mb-3 flex items-center justify-between gap-4">
                    <span className="studio-label">视频时长</span>
                    <span className="studio-value">{duration} 秒</span>
                  </span>
                  <input
                    id="video-duration"
                    className="studio-range"
                    type="range"
                    min={minDuration}
                    max={maxDuration}
                    step={1}
                    value={duration}
                    onChange={(event) => setDuration(Number(event.target.value))}
                    disabled={isGenerating}
                    aria-label="视频时长"
                  />
                  <span className="mt-2 flex justify-between text-[11px] text-stone-600"><span>{minDuration} 秒</span><span>{maxDuration} 秒</span></span>
                </label>

                <div className="mt-5">
                  <SelectField label="生成模式" value={generationMode} onChange={(value) => setGenerationMode(value as GenerationMode)} disabled={isGenerating} options={[["reference", "普通参考"], ["keyframes", "连续关键帧"], ["first-last", "首尾帧"]]} />
                </div>

                <details className="studio-details mt-5" open>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
                    <span className="flex items-center gap-2"><SlidersHorizontal className="size-3.5 text-stone-500" /> 高级设置</span>
                    <ChevronDown className="size-4 text-stone-500 transition-transform" />
                  </summary>
                  <div className="mt-4 grid gap-4 sm:grid-cols-3">
                    <SelectField label="镜头" value={cameraMode} onChange={(value) => setCameraMode(value as CameraMode)} disabled={isGenerating} options={[["auto", "自动"], ["locked", "固定镜头"], ["push-in", "缓慢推进"], ["pull-back", "缓慢拉远"]]} />
                    <SelectField label="运动幅度" value={motionLevel} onChange={(value) => setMotionLevel(value as MotionLevel)} disabled={isGenerating} options={[["auto", "自动"], ["low", "低"], ["medium", "中"], ["high", "高"]]} />
                    <SelectField label="一致性" value={consistencyLevel} onChange={(value) => setConsistencyLevel(value as ConsistencyLevel)} disabled={isGenerating} options={[["normal", "普通"], ["high", "高"], ["very-high", "极高"]]} />
                  </div>
                </details>
              </div>

              <div className="studio-form-section border-t border-stone-800/80">
                <div className="mb-4 flex items-end justify-between gap-4">
                  <div>
                    <p className="studio-index">03 / REFERENCES</p>
                    <h2 className="mt-2 text-lg font-medium tracking-tight text-stone-100">参考素材</h2>
                  </div>
                  <span className="studio-counter">{referenceImages.length} / {maxReferenceImages}</span>
                </div>

                <label className="studio-upload group block" htmlFor="reference-images">
                  <input
                    id="reference-images"
                    className="sr-only"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    multiple
                    onChange={(event) => void handleReferenceImageChange(event.target.files)}
                    disabled={isGenerating}
                  />
                  <span className="studio-upload-icon"><ImagePlus className="size-5" strokeWidth={1.6} /></span>
                  <span className="mt-3 block text-sm font-medium text-stone-200">添加参考图</span>
                  <span className="mt-1 block text-xs text-stone-500">PNG、JPEG 或 WebP · 最多 10 张 · 总大小不超过 8 MB</span>
                  <span className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-lime-200 transition-colors group-hover:text-lime-100"><Upload className="size-3.5" /> 选择文件</span>
                </label>

                <p className="mt-3 text-xs leading-5 text-stone-500">{modeHint}</p>

                {referenceImages.length > 0 && (
                  <ol className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3" aria-label="参考图列表">
                    {referenceImages.map((image, index) => (
                      <li
                        key={image.id}
                        draggable={!isGenerating}
                        onDragStart={() => setDraggedImageId(image.id)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => handleImageDrop(event, image.id)}
                        onDragEnd={() => setDraggedImageId(undefined)}
                        className="studio-reference-card group relative cursor-grab overflow-hidden active:cursor-grabbing"
                      >
                        {/* Data URLs are intentionally kept local so the preview never leaves the browser. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img className="aspect-[4/3] w-full object-cover" src={image.dataUrl} alt={`参考图 ${index + 1}`} />
                        <div className="flex items-center justify-between gap-2 border-t border-stone-800/80 px-2.5 py-2">
                          <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-stone-400"><GripVertical className="size-3 shrink-0 text-stone-600" /> {String(index + 1).padStart(2, "0")}</span>
                          <span className="min-w-0 truncate text-[11px] text-stone-500" title={image.name}>{image.name}</span>
                        </div>
                        <button className="studio-icon-button absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100" type="button" onClick={() => removeReferenceImage(image.id)} disabled={isGenerating} aria-label={`删除 ${image.name}`} title="删除参考图"><Trash2 className="size-3.5" /></button>
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              <div className="border-t border-stone-800/80 p-5 sm:px-7 sm:py-6">
                <button className="studio-submit group flex w-full items-center justify-center gap-2" type="submit" disabled={!prompt.trim() || isGenerating}>
                  {isGenerating ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4 transition-transform group-hover:rotate-12" />}
                  <span>{isGenerating ? "正在生成…" : "生成视频"}</span>
                  {!isGenerating && <ArrowUpRight className="size-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />}
                </button>
              </div>
            </form>
          </section>

          <section className="studio-result-panel lg:sticky lg:top-8" aria-live="polite">
            <div className="flex items-center justify-between gap-4 border-b border-stone-800/80 px-5 py-5 sm:px-7">
              <div>
                <p className="studio-index">OUTPUT / LIVE</p>
                <h2 className="mt-2 text-lg font-medium tracking-tight text-stone-100">生成结果</h2>
              </div>
              <TaskBadge status={task.status} />
            </div>

            <div className="p-4 sm:p-6">
              {task.status === "succeeded" && task.videoUrl ? (
                <div className="space-y-4">
                  <div className="studio-video-frame">
                    <video className="aspect-video w-full object-contain" controls src={task.videoUrl}>
                      当前浏览器不支持视频播放。
                    </video>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <p className="flex items-center gap-2 text-xs text-lime-200"><Check className="size-3.5" /> 视频已准备好</p>
                    <a className="studio-download-button" href={task.videoUrl} target="_blank" rel="noreferrer" download><Download className="size-3.5" /> 下载视频</a>
                  </div>
                </div>
              ) : (
                <div className={`studio-empty-state ${isGenerating ? "is-active" : ""} ${task.status === "failed" ? "is-error" : ""}`}>
                  <div className="studio-empty-icon" aria-hidden="true">
                    {isGenerating ? <LoaderCircle className="size-6 animate-spin" /> : task.status === "failed" ? <CircleAlert className="size-6" /> : <Play className="ml-0.5 size-6" />}
                  </div>
                  <p className="mt-5 text-sm font-medium text-stone-200">
                    {task.status === "idle" && "生成结果会显示在这里"}
                    {task.status === "submitting" && "正在连接视频服务"}
                    {task.status === "queued" && "任务已提交，正在排队"}
                    {task.status === "processing" && "视频正在生成，请耐心等待"}
                    {task.status === "failed" && "这次生成没有完成"}
                  </p>
                  <p className="mt-2 max-w-xs text-center text-xs leading-5 text-stone-500">
                    {task.status === "idle" && "填写左侧提示词并提交后，视频预览与下载入口会出现在这里。"}
                    {isGenerating && "你可以继续等待，页面会自动更新任务状态。"}
                    {task.status === "failed" && task.error}
                  </p>
                  {task.status === "idle" && <div className="mt-6 flex items-center gap-2 text-[11px] text-stone-600"><Move className="size-3.5" /> 结果预览区</div>}
                </div>
              )}
            </div>

            <div className="border-t border-stone-800/80 px-5 py-4 sm:px-7">
              <div className="flex items-center justify-between gap-4 text-[11px] text-stone-600">
                <span>Seedance Studio</span>
                <span>仅在本地保存当前会话</span>
              </div>
            </div>
          </section>
        </div>

        <footer className="mt-8 flex flex-col gap-2 border-t border-stone-800/70 py-5 text-[11px] text-stone-600 sm:flex-row sm:items-center sm:justify-between">
          <span>一个克制、可控的 AI 视频创作界面。</span>
          <span className="inline-flex items-center gap-1.5"><FileImage className="size-3.5" /> 参考素材仅用于当前生成任务</span>
        </footer>
      </div>
    </main>
  );
}

type SelectFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  options: readonly string[] | ReadonlyArray<readonly [string, string]>;
};

function SelectField({ label, value, onChange, disabled, options }: SelectFieldProps) {
  return (
    <label className="block">
      <span className="studio-label mb-2 block">{label}</span>
      <span className="studio-select-wrap block">
        <select className="studio-select" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
          {options.map((option) => {
            const [optionValue, optionLabel] = typeof option === "string" ? [option, option] : option;
            return <option key={optionValue} value={optionValue}>{optionLabel}</option>;
          })}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-stone-500" aria-hidden="true" />
      </span>
    </label>
  );
}

function TaskBadge({ status }: { status: VideoTaskState }) {
  if (status === "succeeded") return <span className="studio-task-badge is-success"><Check className="size-3" /> 完成</span>;
  if (status === "failed") return <span className="studio-task-badge is-error"><X className="size-3" /> 失败</span>;
  if (status === "submitting" || status === "queued" || status === "processing") return <span className="studio-task-badge is-active"><span className="studio-status-dot" /> 处理中</span>;
  return <span className="studio-task-badge">等待输入</span>;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

function dataUrlByteLength(value: string): number {
  const base64 = value.split(",", 2)[1] ?? "";
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return (base64.length * 3) / 4 - padding;
}

function createReferenceImageId(index: number): string {
  return `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`;
}

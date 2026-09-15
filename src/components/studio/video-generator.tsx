"use client";

import { DragEvent, FormEvent, useEffect, useRef, useState } from "react";

import { buildFinalPrompt, maxFinalPromptLength, resolveGenerationMode, type CameraMode, type ConsistencyLevel, type GenerationMode, type MotionLevel } from "@/lib/video/prompt-compiler";
import { reorderReferenceImages, type ReferenceImage } from "@/lib/video/reference-images";
import { aspectRatioOptions, defaultDuration, defaultSeedanceModel, maxDuration, minDuration, resolutionOptions } from "@/lib/video/models";

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
    if (pollTimerRef.current) { clearTimeout(pollTimerRef.current); pollTimerRef.current = null; }
    pollAbortRef.current?.abort();
    pollAbortRef.current = null;
  };

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; stopPolling(); submitAbortRef.current?.abort(); submitAbortRef.current = null; };
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
      setTask({ taskId: "", status: "failed", error: `参考图最多可上传 ${maxReferenceImages} 张。` }); return;
    }
    if (selectedFiles.some((file) => !acceptedImageTypes.has(file.type))) {
      setTask({ taskId: "", status: "failed", error: "参考图仅支持 PNG、JPEG 或 WebP 格式。" }); return;
    }
    const existingBytes = referenceImages.reduce((total, image) => total + dataUrlByteLength(image.dataUrl), 0);
    const selectedBytes = selectedFiles.reduce((total, file) => total + file.size, 0);
    if (existingBytes + selectedBytes > maxImageBytes) {
      setTask({ taskId: "", status: "failed", error: "参考图总大小不能超过 8 MB。" }); return;
    }
    try {
      const nextImages = await Promise.all(selectedFiles.map(async (file, index) => ({ id: createReferenceImageId(index), name: file.name, dataUrl: await readFileAsDataUrl(file) })));
      if (!isMountedRef.current) return;
      setReferenceImages((images) => [...images, ...nextImages]);
      setTask({ taskId: "", status: "idle" });
    } catch {
      if (isMountedRef.current) setTask({ taskId: "", status: "failed", error: "读取参考图失败，请重新选择。" });
    }
  }

  function removeReferenceImage(id: string) {
    setReferenceImages((images) => images.filter((image) => image.id !== id));
    setTask({ taskId: "", status: "idle" });
  }

  function handleImageDrop(event: DragEvent<HTMLLIElement>, targetId: string) {
    event.preventDefault();
    if (draggedImageId) setReferenceImages((images) => reorderReferenceImages(images, draggedImageId, targetId));
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
    const finalPrompt = buildFinalPrompt({ userPrompt: prompt, referenceImageCount: referenceImages.length, generationMode: effectiveGenerationMode, cameraMode, motionLevel, consistencyLevel });
    if (finalPrompt.length > maxFinalPromptLength) {
      if (submitAbortRef.current === controller) submitAbortRef.current = null;
      setTask({ taskId: "", status: "failed", error: `当前提示词加控制指令后不能超过 ${maxFinalPromptLength} 个字符，请缩短提示词。` });
      return;
    }
    const imagesForGeneration = effectiveGenerationMode === "first-last" && referenceImages.length > 2
      ? [referenceImages[0], referenceImages[referenceImages.length - 1]]
      : referenceImages;
    try {
      const response = await fetch("/api/generate", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({
          prompt: finalPrompt,
          model: defaultSeedanceModel(), resolution, aspectRatio, duration,
          referenceImageDataUrls: imagesForGeneration.map((image) => image.dataUrl),
        }),
      });
      const payload = (await response.json()) as { taskId?: string; error?: string };
      if (!isMountedRef.current || controller.signal.aborted) return;
      if (!response.ok || !payload.taskId) throw new Error(payload.error ?? "视频任务创建失败，请稍后重试。");
      const nextTask = { taskId: payload.taskId, status: "queued" as const };
      setTask(nextTask);
      await pollTask(nextTask.taskId);
    } catch (error) {
      if (!isMountedRef.current || controller.signal.aborted) return;
      setTask({ taskId: "", status: "failed", error: error instanceof Error ? error.message : "视频任务创建失败，请稍后重试。" });
    } finally { if (submitAbortRef.current === controller) submitAbortRef.current = null; }
  }

  async function pollTask(taskId: string) {
    if (!isMountedRef.current) return;
    const controller = new AbortController(); pollAbortRef.current = controller;
    try {
      const response = await fetch(`/api/task/${encodeURIComponent(taskId)}`, { cache: "no-store", signal: controller.signal });
      const payload = (await response.json()) as VideoTask;
      if (!isMountedRef.current || controller.signal.aborted) return;
      if (!response.ok) throw new Error(payload.error ?? "视频任务查询失败，请稍后重试。");
      setTask(payload);
      if (payload.status === "succeeded" || payload.status === "failed") { stopPolling(); return; }
      pollTimerRef.current = setTimeout(() => { if (isMountedRef.current) void pollTask(taskId); }, 5_000);
    } catch (error) {
      if (!isMountedRef.current || controller.signal.aborted) return;
      setTask({ taskId, status: "failed", error: error instanceof Error ? error.message : "视频任务查询失败，请稍后重试。" }); stopPolling();
    } finally { if (pollAbortRef.current === controller) pollAbortRef.current = null; }
  }

  return <main className="min-h-screen bg-zinc-950 px-4 py-10 text-zinc-100 sm:px-6"><section className="mx-auto w-full max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl shadow-black/20 sm:p-8">
    <header className="mb-8"><p className="text-sm font-medium text-zinc-400">Seedance Studio</p><h1 className="mt-2 text-2xl font-semibold tracking-tight">视频生成</h1><p className="mt-2 text-sm leading-6 text-zinc-400">输入提示词，可选上传参考图，然后等待视频生成完成。</p></header>
    <form className="space-y-6" onSubmit={handleSubmit}>
      <label className="block"><span className="mb-2 block text-sm font-medium">提示词</span><textarea className="min-h-36 w-full resize-y rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm leading-6 outline-none placeholder:text-zinc-600 focus:border-zinc-400" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="请输入你想生成的视频内容" maxLength={2000} disabled={isGenerating} required /></label>
      <section className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3"><h2 className="text-sm font-medium">已配置模型</h2><p className="mt-1 text-sm text-zinc-300">Seedance 视频生成</p><p className="mt-1 text-xs text-zinc-500">火山方舟接入点已配置，只需填写 API Key 即可使用。</p></section>
      <div className="grid gap-4 sm:grid-cols-3"><SelectField label="分辨率" value={resolution} onChange={(value) => setResolution(value as typeof resolution)} disabled={isGenerating} options={resolutionOptions} /><SelectField label="画面比例" value={aspectRatio} onChange={(value) => setAspectRatio(value as typeof aspectRatio)} disabled={isGenerating} options={aspectRatioOptions} /><label className="block"><span className="mb-2 flex items-center justify-between text-sm font-medium"><span>视频时长</span><span className="text-zinc-400">{duration} 秒</span></span><input className="w-full accent-white disabled:cursor-not-allowed disabled:opacity-50" type="range" min={minDuration} max={maxDuration} step={1} value={duration} onChange={(event) => setDuration(Number(event.target.value))} disabled={isGenerating} aria-label="视频时长" /><span className="mt-1 flex justify-between text-xs text-zinc-500"><span>{minDuration} 秒</span><span>{maxDuration} 秒</span></span></label></div>
      <SelectField label="生成模式" value={generationMode} onChange={(value) => setGenerationMode(value as GenerationMode)} disabled={isGenerating} options={[["reference", "普通参考"], ["keyframes", "连续关键帧"], ["first-last", "首尾帧"]]} />
      <details className="rounded-xl border border-zinc-800 bg-zinc-950 p-4" open><summary className="cursor-pointer text-sm font-medium">高级设置</summary><div className="mt-4 grid gap-4 sm:grid-cols-3"><SelectField label="镜头" value={cameraMode} onChange={(value) => setCameraMode(value as CameraMode)} disabled={isGenerating} options={[["auto", "自动"], ["locked", "固定镜头"], ["push-in", "缓慢推进"], ["pull-back", "缓慢拉远"]]} /><SelectField label="运动幅度" value={motionLevel} onChange={(value) => setMotionLevel(value as MotionLevel)} disabled={isGenerating} options={[["auto", "自动"], ["low", "低"], ["medium", "中"], ["high", "高"]]} /><SelectField label="一致性" value={consistencyLevel} onChange={(value) => setConsistencyLevel(value as ConsistencyLevel)} disabled={isGenerating} options={[["normal", "普通"], ["high", "高"], ["very-high", "极高"]]} /></div></details>
      <section><label className="block"><span className="mb-2 block text-sm font-medium">参考图（可选，最多 10 张）</span><input className="block w-full cursor-pointer rounded-xl border border-dashed border-zinc-700 bg-zinc-950 px-3 py-3 text-sm text-zinc-300 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-800 file:px-3 file:py-2 file:text-sm file:text-zinc-100 hover:file:bg-zinc-700" type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(event) => void handleReferenceImageChange(event.target.files)} disabled={isGenerating} /></label><p className="mt-2 text-xs text-zinc-500">{referenceImages.length > 0 ? `已选择 ${referenceImages.length} 张，可拖拽排序。` : "支持 PNG、JPEG、WebP，最多 10 张，总大小不超过 8 MB"}</p><p className="mt-1 text-xs text-zinc-500">{modeHint}</p>{referenceImages.length > 0 && <ol className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">{referenceImages.map((image, index) => <li key={image.id} draggable={!isGenerating} onDragStart={() => setDraggedImageId(image.id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => handleImageDrop(event, image.id)} onDragEnd={() => setDraggedImageId(undefined)} className="group relative cursor-grab overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 active:cursor-grabbing"><img className="aspect-square w-full object-cover" src={image.dataUrl} alt={`参考图 ${index + 1}`} /><div className="flex items-center justify-between gap-2 px-2 py-2 text-xs"><span className="shrink-0 font-medium text-zinc-200">{String(index + 1).padStart(2, "0")}</span><span className="min-w-0 truncate text-zinc-400">{image.name}</span></div><button className="absolute right-2 top-2 rounded-md bg-zinc-950/90 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-700 disabled:opacity-50" type="button" onClick={() => removeReferenceImage(image.id)} disabled={isGenerating} aria-label={`删除 ${image.name}`}>删除</button></li>)}</ol>}</section>
      <button className="w-full rounded-xl bg-white px-4 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50" type="submit" disabled={!prompt.trim() || isGenerating}>{isGenerating ? "正在生成…" : "生成视频"}</button>
    </form>
    <section className="mt-8 border-t border-zinc-800 pt-6" aria-live="polite"><h2 className="text-sm font-medium">生成结果</h2>{task.status === "idle" && <p className="mt-2 text-sm text-zinc-500">尚未提交任务。</p>}{isGenerating && <p className="mt-2 text-sm text-zinc-300">{task.status === "submitting" ? "正在提交任务…" : "视频正在生成，请耐心等待…"}</p>}{task.status === "failed" && <p className="mt-2 text-sm text-red-300">{task.error}</p>}{task.status === "succeeded" && task.videoUrl && <div className="mt-4 space-y-3"><video className="w-full rounded-xl bg-black" controls src={task.videoUrl}>当前浏览器不支持视频播放。</video><a className="inline-flex rounded-lg border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800" href={task.videoUrl} target="_blank" rel="noreferrer" download>下载视频</a></div>}</section>
  </section></main>;
}

type SelectFieldProps = { label: string; value: string; onChange: (value: string) => void; disabled: boolean; options: readonly string[] | ReadonlyArray<readonly [string, string]> };
function SelectField({ label, value, onChange, disabled, options }: SelectFieldProps) { return <label className="block"><span className="mb-2 block text-sm font-medium">{label}</span><select className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm outline-none focus:border-zinc-400 disabled:cursor-not-allowed disabled:opacity-50" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>{options.map((option) => { const [optionValue, optionLabel] = typeof option === "string" ? [option, option] : option; return <option key={optionValue} value={optionValue}>{optionLabel}</option>; })}</select></label>; }
function readFileAsDataUrl(file: File): Promise<string> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(reader.error); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(file); }); }
function dataUrlByteLength(value: string): number { const base64 = value.split(",", 2)[1] ?? ""; const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0; return (base64.length * 3) / 4 - padding; }
function createReferenceImageId(index: number): string { return `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`; }

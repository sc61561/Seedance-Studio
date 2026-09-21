import { describe, expect, it } from "vitest";

import {
  buildFinalPrompt,
  maxFinalPromptLength,
  resolveGenerationMode,
} from "@/lib/video/prompt-compiler";

describe("buildFinalPrompt", () => {
  it("按模式与高级控制项编译提示词，并保留用户原始提示词", () => {
    expect(
      buildFinalPrompt({
        userPrompt: "一只橘猫在窗边伸懒腰",
        generationMode: "ordered-reference",
        referenceImageCount: 3,
        cameraMode: "push-in",
        motionLevel: "medium",
        consistencyLevel: "high",
      }),
    ).toBe([
      "一只橘猫在窗边伸懒腰",
      "Use the uploaded images as chronological keyframes in the exact order provided. Image 1 represents the beginning of the video, the intermediate images represent progressive stages of the action, and the final image represents the ending state. Generate smooth, natural and temporally coherent motion between these keyframes. Resolve minor visual inconsistencies between reference images automatically while preserving the main subject, environment and intended action.",
      "Treat the uploaded reference images as chronological keyframes in the exact order provided. Image 1 = 起始，中间图片 = 动作发展，最后图片 = 结束。",
      "Use a very slow and smooth cinematic push-in. Keep the movement subtle and stable. Avoid sudden camera motion.",
      "Use moderate and natural motion with smooth transitions between actions. Avoid abrupt or exaggerated movement.",
      "Maintain high temporal consistency throughout the entire video. Preserve character identity, body proportions, facial features, clothing or fur patterns, environment layout, object positions, lighting and visual style. Avoid flickering, morphing, teleportation and inconsistent geometry.",
    ].join("\n\n"));
  });

  it("自动选项不会附加额外镜头或运动指令", () => {
    expect(
      buildFinalPrompt({
        userPrompt: "海边日落",
        generationMode: "reference",
        referenceImageCount: 1,
        cameraMode: "auto",
        motionLevel: "auto",
        consistencyLevel: "normal",
      }),
    ).toBe([
      "海边日落",
      "Use the uploaded images as visual references. Preserve the identity, appearance, environment and visual style shown in the reference images.",
      "Maintain visual and temporal consistency throughout the video.",
    ].join("\n\n"));
  });

  it.each(["first-frame", "first-last"] as const)(
    "%s 使用方舟原生图片角色，不附加参考、关键帧或转场指令",
    (generationMode) => {
      const prompt = buildFinalPrompt({
        userPrompt: "人物从站立变为坐下",
        generationMode,
        referenceImageCount: generationMode === "first-frame" ? 1 : 2,
        cameraMode: "auto",
        motionLevel: "auto",
        consistencyLevel: "normal",
      });

      expect(prompt).toBe([
        "人物从站立变为坐下",
        "Maintain visual and temporal consistency throughout the video.",
      ].join("\n\n"));
      expect(prompt).not.toMatch(/reference|keyframe|starting state|ending state|transition/i);
    },
  );

  it.each([
    ["ordered-reference", 0],
    ["ordered-reference", 1],
    ["first-frame", 0],
    ["first-frame", 2],
    ["first-last", 0],
    ["first-last", 1],
    ["first-last", 3],
  ] as const)("解析模式时不会把 %s（%d 张图）静默降级", (mode, imageCount) => {
    expect(resolveGenerationMode(mode, imageCount)).toBe(mode);
  });

  it("共享最终提示词长度上限", () => {
    expect(maxFinalPromptLength).toBe(4_000);
  });

  it("零张参考图时不编译不存在的参考图指令", () => {
    expect(
      buildFinalPrompt({
        userPrompt: "海边日落",
        generationMode: "reference",
        cameraMode: "auto",
        motionLevel: "auto",
        consistencyLevel: "normal",
        referenceImageCount: 0,
      }),
    ).toBe([
      "海边日落",
      "Maintain visual and temporal consistency throughout the video.",
    ].join("\n\n"));
  });
});

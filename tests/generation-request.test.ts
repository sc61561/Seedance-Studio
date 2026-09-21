import { describe, expect, it, vi } from "vitest";

import {
  createGenerationRequestController,
  buildGenerationRequestInit,
  buildGenerationRequestSnapshot,
  createGenerationRequestSnapshotCache,
} from "@/lib/video/generation-request";
import {
  buildGenerationTargetView,
  getUiModelSelection,
} from "@/lib/video/generation-form";
import { maxGenerationRequestBytes } from "@/lib/video/reference-image-limits";
import { resolveSeedanceTarget } from "@/lib/video/models";

const commonInput = {
  userPrompt: "猫穿过雨夜",
  generationMode: "ordered-reference" as const,
  generateAudio: true,
  cameraMode: "locked" as const,
  motionLevel: "low" as const,
  consistencyLevel: "high" as const,
  duration: 8,
  resolution: "1080p" as const,
  aspectRatio: "16:9" as const,
};

describe("generation request snapshot", () => {
  it("预览提示词与解析后的请求 prompt 完全一致，且官方模型不带 profile", () => {
    const snapshot = buildGenerationRequestSnapshot({
      ...commonInput,
      target: resolveSeedanceTarget("doubao-seedance-2-5-260628")!,
      referenceImagePayload: {
        referenceImageUrls: ["https://example.com/1.png", "https://example.com/2.png"],
      },
    });
    const parsed = JSON.parse(snapshot.body);

    expect(parsed.prompt).toBe(snapshot.finalPrompt);
    expect(parsed.model).toBe("doubao-seedance-2-5-260628");
    expect(parsed).not.toHaveProperty("modelProfile");
    expect(parsed.generationMode).toBe("ordered-reference");
    expect(parsed.generateAudio).toBe(true);
  });

  it("自定义 Endpoint 仅在本地请求中携带所选 capability profile", () => {
    const snapshot = buildGenerationRequestSnapshot({
      ...commonInput,
      target: resolveSeedanceTarget(
        "ep-team-video",
        "doubao-seedance-2-0-260128",
      )!,
      referenceImagePayload: {},
      generationMode: "reference",
    });

    expect(JSON.parse(snapshot.body)).toMatchObject({
      model: "ep-team-video",
      modelProfile: "doubao-seedance-2-0-260128",
    });
  });

  it("显式 audio false 和全部图片顺序原样进入同一个 body 字符串", () => {
    const images = [
      "data:image/png;base64,AAAA",
      "data:image/png;base64,BBBB",
      "data:image/png;base64,CCCC",
    ];
    const snapshot = buildGenerationRequestSnapshot({
      ...commonInput,
      target: resolveSeedanceTarget("doubao-seedance-2-5-260628")!,
      generateAudio: false,
      generationMode: "reference",
      referenceImagePayload: { referenceImageDataUrls: images },
    });
    const request = buildGenerationRequestInit(snapshot, "ark-key");
    const parsed = JSON.parse(String(request.body));

    expect(parsed.generateAudio).toBe(false);
    expect(parsed.referenceImageDataUrls).toEqual(images);
    expect(request.body).toBe(snapshot.body);
    expect(snapshot.byteLength).toBe(new TextEncoder().encode(snapshot.body).byteLength);
    expect(snapshot.exceedsByteLimit).toBe(false);
  });

  it("精确 UTF-8 body 超过上限时标记为不可发送且不截断", () => {
    const snapshot = buildGenerationRequestSnapshot({
      ...commonInput,
      target: resolveSeedanceTarget("doubao-seedance-2-5-260628")!,
      generationMode: "reference",
      referenceImagePayload: {
        referenceImageDataUrls: [`data:image/png;base64,${"A".repeat(maxGenerationRequestBytes)}`],
      },
    });

    expect(snapshot.byteLength).toBeGreaterThan(maxGenerationRequestBytes);
    expect(snapshot.exceedsByteLimit).toBe(true);
    expect(snapshot.body).toContain("A".repeat(100));
  });

  it("无关 render 的等价输入复用同一 snapshot，真实表单或图片变化才重新序列化", () => {
    const build = vi.fn(buildGenerationRequestSnapshot);
    const cache = createGenerationRequestSnapshotCache(build);
    const target = resolveSeedanceTarget("doubao-seedance-2-5-260628")!;
    const referenceImageUrls = ["https://example.com/1.png"];
    const firstInput = {
      ...commonInput,
      target,
      referenceImagePayload: { referenceImageUrls },
    };

    const first = cache.get(firstInput);
    const unrelatedRender = cache.get({
      ...firstInput,
      target: resolveSeedanceTarget("doubao-seedance-2-5-260628")!,
      referenceImagePayload: { referenceImageUrls },
    });

    expect(unrelatedRender).toBe(first);
    expect(unrelatedRender.body).toBe(first.body);
    expect(build).toHaveBeenCalledTimes(1);

    const changedPrompt = cache.get({ ...firstInput, userPrompt: "猫穿过雪夜" });
    expect(changedPrompt).not.toBe(first);
    expect(build).toHaveBeenCalledTimes(2);

    const changedImages = cache.get({
      ...firstInput,
      userPrompt: "猫穿过雪夜",
      referenceImagePayload: {
        referenceImageUrls: ["https://example.com/1.png", "https://example.com/2.png"],
      },
    });
    expect(changedImages).not.toBe(changedPrompt);
    expect(build).toHaveBeenCalledTimes(3);
  });

  it("storage 模型调整、audio false、图片顺序、preview/fetch body 共用同一生产边界", () => {
    const targetState = getUiModelSelection({
      model: "ep-team-video",
      modelProfile: "doubao-seedance-2-0-fast-260128",
    });
    const imageUrls = [
      "https://example.com/first.png",
      "https://example.com/second.png",
    ];
    const targetView = buildGenerationTargetView(targetState, {
      duration: 30,
      resolution: "1080p",
      aspectRatio: "16:9",
      generationMode: "ordered-reference",
    }, imageUrls);
    const cache = createGenerationRequestSnapshotCache();
    const controller = createGenerationRequestController(cache, {
      ...commonInput,
      target: targetView.resolvedTarget!,
      duration: targetView.controls.duration,
      resolution: targetView.controls.resolution,
      aspectRatio: targetView.controls.aspectRatio,
      generationMode: targetView.controls.generationMode,
      generateAudio: false,
      referenceImagePayload: { referenceImageUrls: targetView.referenceImages },
    });
    const request = controller.buildRequestInit("ark-key");
    const parsed = JSON.parse(controller.snapshot.body);

    expect(targetView.adjusted).toBe(true);
    expect(parsed).toMatchObject({
      model: "ep-team-video",
      modelProfile: "doubao-seedance-2-0-fast-260128",
      duration: 15,
      resolution: "720p",
      generationMode: "ordered-reference",
      generateAudio: false,
      referenceImageUrls: imageUrls,
    });
    expect(parsed.prompt).toBe(controller.snapshot.finalPrompt);
    expect(request.body).toBe(controller.snapshot.body);
  });
});

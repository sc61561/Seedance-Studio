import { describe, expect, it } from "vitest";

import {
  adjustGenerationControls,
  buildActiveTaskPersistenceFields,
  buildGenerationTargetView,
  getGenerationModeGuidance,
  getModelSettingsForUiSelection,
  getRecoveredTaskPresentation,
  getUiModelSelection,
  shouldShow4KWarning,
} from "@/lib/video/generation-form";
import { getSeedanceModelProfile, resolveSeedanceTarget } from "@/lib/video/models";

describe("generation form helpers", () => {
  it("切换到受限档案时只调整失效的时长、分辨率和比例", () => {
    const profile = getSeedanceModelProfile("doubao-seedance-2-0-fast-260128")!;
    const images = ["one", "two", "three"];

    const result = adjustGenerationControls({
      duration: 30,
      resolution: "4k",
      aspectRatio: "16:9",
      generationMode: "first-last",
    }, profile);

    expect(result.controls).toEqual({
      duration: 15,
      resolution: "720p",
      aspectRatio: "16:9",
      generationMode: "first-last",
    });
    expect(result.adjusted).toBe(true);
    expect(images).toEqual(["one", "two", "three"]);
  });

  it("2.5 原生首帧模式只把无效比例调整为 adaptive，不改模式或其他有效控件", () => {
    const profile = getSeedanceModelProfile("doubao-seedance-2-5-260628")!;

    expect(adjustGenerationControls({
      duration: 12,
      resolution: "1080p",
      aspectRatio: "9:16",
      generationMode: "first-frame",
    }, profile)).toEqual({
      controls: {
        duration: 12,
        resolution: "1080p",
        aspectRatio: "adaptive",
        generationMode: "first-frame",
      },
      adjusted: true,
    });
  });

  it("有效控件保持原样且不显示调整通知", () => {
    const profile = getSeedanceModelProfile("doubao-seedance-2-0-260128")!;
    const controls = {
      duration: 9,
      resolution: "4k" as const,
      aspectRatio: "21:9" as const,
      generationMode: "ordered-reference" as const,
    };

    expect(adjustGenerationControls(controls, profile)).toEqual({
      controls,
      adjusted: false,
    });
  });

  it.each([
    ["reference", 0, false, "hint.referenceRange"],
    ["reference", 11, true, "err.referenceRange"],
    ["ordered-reference", 1, true, "err.orderedReferenceCount"],
    ["ordered-reference", 2, false, "hint.orderedReferenceRange"],
    ["first-frame", 0, true, "err.firstFrameCount"],
    ["first-frame", 1, false, "hint.firstFrameCount"],
    ["first-last", 1, true, "err.firstLastCount"],
    ["first-last", 2, false, "hint.firstLastCount"],
  ] as const)("%s / %i 张图片得到精确提示", (generationMode, count, isError, key) => {
    const profile = getSeedanceModelProfile("doubao-seedance-2-5-260628")!;
    expect(getGenerationModeGuidance(profile, generationMode, count)).toMatchObject({
      isError,
      key,
    });
  });

  it("2.0 普通参考使用有效上限 9", () => {
    const profile = getSeedanceModelProfile("doubao-seedance-2-0-mini-260615")!;
    expect(getGenerationModeGuidance(profile, "reference", 10)).toEqual({
      isError: true,
      key: "err.referenceRange",
      params: { min: 0, max: 9, n: 9 },
    });
  });

  it("4K 警告仅用于标准 2.0 的 4K", () => {
    expect(shouldShow4KWarning("doubao-seedance-2-0-260128", "4k")).toBe(true);
    expect(shouldShow4KWarning("doubao-seedance-2-5-260628", "4k")).toBe(false);
    expect(shouldShow4KWarning("doubao-seedance-2-0-260128", "1080p")).toBe(false);
  });

  it("在 UI 官方/自定义选择与本地设置之间保留合法目标", () => {
    expect(getUiModelSelection({ model: "doubao-seedance-2-0-fast-260128" })).toEqual({
      selection: "doubao-seedance-2-0-fast-260128",
      customEndpoint: "",
      customProfile: "doubao-seedance-2-5-260628",
    });
    expect(getUiModelSelection({
      model: "ep-team-video",
      modelProfile: "doubao-seedance-2-0-260128",
    })).toEqual({
      selection: "custom-endpoint",
      customEndpoint: "ep-team-video",
      customProfile: "doubao-seedance-2-0-260128",
    });
    expect(getModelSettingsForUiSelection({
      selection: "custom-endpoint",
      customEndpoint: "ep-team-video",
      customProfile: "doubao-seedance-2-0-260128",
    })).toEqual({
      model: "ep-team-video",
      modelProfile: "doubao-seedance-2-0-260128",
    });
    expect(getModelSettingsForUiSelection({
      selection: "custom-endpoint",
      customEndpoint: "not-an-endpoint",
      customProfile: "doubao-seedance-2-0-260128",
    })).toBeUndefined();
  });

  it.each([
    [
      "非默认官方模型",
      resolveSeedanceTarget("doubao-seedance-2-0-fast-260128")!,
      "doubao-seedance-2-0-fast-260128",
    ],
    [
      "自定义 Endpoint",
      resolveSeedanceTarget("ep-team-video", "doubao-seedance-2-0-260128")!,
      "ep-team-video",
    ],
  ])("%s 的活动任务记录真实 target 且不混入 profile 或敏感表单内容", (_label, target, model) => {
    const fields = buildActiveTaskPersistenceFields(target, {
      resolution: "1080p",
      aspectRatio: "9:16",
      duration: 8,
    });

    expect(fields).toEqual({
      model,
      resolution: "1080p",
      aspectRatio: "9:16",
      duration: 8,
    });
    expect(fields).not.toHaveProperty("modelProfile");
    expect(fields).not.toHaveProperty("apiKey");
    expect(fields).not.toHaveProperty("prompt");
    expect(fields).not.toHaveProperty("referenceImages");
  });

  it.each([2, 3])("legacy %i 秒活动任务只恢复查询状态，不污染新表单控件", (duration) => {
    const legacyTask = {
      version: 1 as const,
      taskId: `cgt-legacy-${duration}`,
      status: "queued" as const,
      createdAt: 1_800_000_000_000,
      model: "legacy-model",
      resolution: "4k",
      aspectRatio: "9:16",
      duration,
    };

    expect(getRecoveredTaskPresentation(legacyTask)).toEqual({
      taskId: `cgt-legacy-${duration}`,
      status: "queued",
    });
  });

  it("跨 tab 存储切到 Fast profile 时同步调整控件并保留 mode/图片顺序", () => {
    const storedTarget = getUiModelSelection({
      model: "doubao-seedance-2-0-fast-260128",
    });
    const images = [{ id: "first" }, { id: "second" }];

    const view = buildGenerationTargetView(storedTarget, {
      duration: 30,
      resolution: "1080p",
      aspectRatio: "21:9",
      generationMode: "ordered-reference",
    }, images);

    expect(view.resolvedTarget?.model).toBe("doubao-seedance-2-0-fast-260128");
    expect(view.profile.id).toBe("doubao-seedance-2-0-fast-260128");
    expect(view.controls).toEqual({
      duration: 15,
      resolution: "720p",
      aspectRatio: "21:9",
      generationMode: "ordered-reference",
    });
    expect(view.adjusted).toBe(true);
    expect(view.referenceImages).toBe(images);
    expect(view.referenceImages.map((image) => image.id)).toEqual(["first", "second"]);

    const switchedBack = buildGenerationTargetView(getUiModelSelection({
      model: "doubao-seedance-2-5-260628",
    }), view.controls, view.referenceImages);
    expect(switchedBack.controls).toEqual({
      duration: 15,
      resolution: "720p",
      aspectRatio: "21:9",
      generationMode: "ordered-reference",
    });
    expect(switchedBack.adjusted).toBe(false);
  });
});

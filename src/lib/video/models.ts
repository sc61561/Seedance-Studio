export const resolutionOptions = ["480p", "720p", "1080p"] as const;
export const aspectRatioOptions = ["16:9", "9:16", "1:1", "4:3", "3:4"] as const;
export const durationOptions = [5, 10] as const;

export type Resolution = (typeof resolutionOptions)[number];
export type AspectRatio = (typeof aspectRatioOptions)[number];
export type Duration = (typeof durationOptions)[number];

export const seedanceModels = [
  {
    id: "doubao-seedance-2-5-260628",
    label: "Seedance 2.5（最新一代）",
    resolutions: ["480p", "720p"],
  },
  {
    id: "doubao-seedance-2-0-260128",
    label: "Seedance 2.0（质量优先）",
    resolutions: ["480p", "720p", "1080p"],
  },
  {
    id: "doubao-seedance-2-0-fast-260128",
    label: "Seedance 2.0 Fast（速度/成本平衡）",
    resolutions: ["480p", "720p"],
  },
  {
    id: "doubao-seedance-2-0-mini-260615",
    label: "Seedance 2.0 Mini（批量生成）",
    resolutions: ["480p", "720p"],
  },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  resolutions: readonly Resolution[];
}>;

export type SeedanceModelId = (typeof seedanceModels)[number]["id"];

export function defaultSeedanceModel(): SeedanceModelId {
  return "doubao-seedance-2-5-260628";
}

export function getSeedanceModel(model: string) {
  return seedanceModels.find((item) => item.id === model);
}

export function modelSupportsResolution(model: string, resolution: string): boolean {
  return Boolean(getSeedanceModel(model)?.resolutions.some((item) => item === resolution));
}

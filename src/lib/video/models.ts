export const resolutionOptions = ["480p", "720p", "1080p"] as const;
export const aspectRatioOptions = ["16:9", "9:16", "1:1", "4:3", "3:4"] as const;
export const durationOptions = [5, 10] as const;

export type Resolution = (typeof resolutionOptions)[number];
export type AspectRatio = (typeof aspectRatioOptions)[number];
export type Duration = (typeof durationOptions)[number];

export const seedanceEndpointId = "ep-20260829185420-qnfvz";

export const seedanceModels = [
  {
    id: seedanceEndpointId,
    label: "Seedance 视频生成（已配置）",
    resolutions: ["480p", "720p", "1080p"],
  },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  resolutions: readonly Resolution[];
}>;

export type SeedanceModelId = (typeof seedanceModels)[number]["id"];

export function defaultSeedanceModel(): SeedanceModelId {
  return seedanceEndpointId;
}

export function getSeedanceModel(model: string) {
  return seedanceModels.find((item) => item.id === model);
}

export function modelSupportsResolution(model: string, resolution: string): boolean {
  return Boolean(getSeedanceModel(model)?.resolutions.some((item) => item === resolution));
}

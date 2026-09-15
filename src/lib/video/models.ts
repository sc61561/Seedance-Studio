export const seedanceModels = [
  {
    id: "doubao-seedance-1-5-pro-251215",
    label: "Seedance 1.5 Pro（文生 / 首帧图生）",
  },
  {
    id: "doubao-seedance-1-0-pro-250528",
    label: "Seedance 1.0 Pro（文生 / 首帧图生）",
  },
] as const;

export type SeedanceModelId = (typeof seedanceModels)[number]["id"];

export function defaultSeedanceModel(): SeedanceModelId {
  return "doubao-seedance-1-5-pro-251215";
}

export function getSeedanceModel(model: string) {
  return seedanceModels.find((item) => item.id === model);
}

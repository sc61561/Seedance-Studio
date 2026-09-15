export type GenerationMode = "reference" | "keyframes" | "first-last";
export type CameraMode = "auto" | "locked" | "push-in" | "pull-back";
export type MotionLevel = "auto" | "low" | "medium" | "high";
export type ConsistencyLevel = "normal" | "high" | "very-high";

export type PromptCompilerInput = {
  userPrompt: string;
  referenceImageCount?: number;
  generationMode: GenerationMode;
  cameraMode: CameraMode;
  motionLevel: MotionLevel;
  consistencyLevel: ConsistencyLevel;
};

export const maxFinalPromptLength = 2_000;

export function resolveGenerationMode(
  requestedMode: GenerationMode,
  referenceImageCount: number,
): GenerationMode {
  return requestedMode !== "reference" && referenceImageCount < 2
    ? "reference"
    : requestedMode;
}

const generationModePrompts: Record<GenerationMode, string[]> = {
  reference: [
    "Use the uploaded images as visual references. Preserve the identity, appearance, environment and visual style shown in the reference images.",
  ],
  keyframes: [
    "Use the uploaded images as chronological keyframes in the exact order provided. Image 1 represents the beginning of the video, the intermediate images represent progressive stages of the action, and the final image represents the ending state. Generate smooth, natural and temporally coherent motion between these keyframes. Resolve minor visual inconsistencies between reference images automatically while preserving the main subject, environment and intended action.",
    "Treat the uploaded reference images as chronological keyframes in the exact order provided. Image 1 = 起始，中间图片 = 动作发展，最后图片 = 结束。",
  ],
  "first-last": [
    "Use the first uploaded image as the starting state and the final uploaded image as the ending state. Generate a smooth, natural and temporally coherent transition between them while preserving subject identity and environment consistency.",
  ],
};

const cameraPrompts: Partial<Record<CameraMode, string>> = {
  locked: "Locked static camera. Keep the camera completely stationary throughout the video. No camera movement, zoom, pan, tilt, rotation or camera shake.",
  "push-in": "Use a very slow and smooth cinematic push-in. Keep the movement subtle and stable. Avoid sudden camera motion.",
  "pull-back": "Use a very slow and smooth cinematic pull-back. Keep the movement subtle and stable. Avoid sudden camera motion.",
};

const motionPrompts: Partial<Record<MotionLevel, string>> = {
  low: "Use subtle, restrained and natural movement. Avoid exaggerated motion, sudden acceleration and large pose changes.",
  medium: "Use moderate and natural motion with smooth transitions between actions. Avoid abrupt or exaggerated movement.",
  high: "Allow larger and more expressive motion while maintaining temporal coherence, physical plausibility and subject consistency.",
};

const consistencyPrompts: Record<ConsistencyLevel, string> = {
  normal: "Maintain visual and temporal consistency throughout the video.",
  high: "Maintain high temporal consistency throughout the entire video. Preserve character identity, body proportions, facial features, clothing or fur patterns, environment layout, object positions, lighting and visual style. Avoid flickering, morphing, teleportation and inconsistent geometry.",
  "very-high": "Prioritize temporal and identity consistency very strongly. Preserve the exact subject identity, body proportions, facial features, clothing or fur pattern, colors, accessories and environment across every frame. Keep static background objects spatially stable. Resolve small inconsistencies between reference images smoothly. Avoid character redesign, object drift, flickering, morphing, duplicated subjects, extra limbs, teleportation and sudden geometry changes.",
};

export function buildFinalPrompt(input: PromptCompilerInput): string {
  const referencePrompts = input.referenceImageCount === 0
    ? []
    : generationModePrompts[input.generationMode];

  return [
    input.userPrompt.trim(),
    ...referencePrompts,
    cameraPrompts[input.cameraMode],
    motionPrompts[input.motionLevel],
    consistencyPrompts[input.consistencyLevel],
  ].filter((part): part is string => Boolean(part)).join("\n\n");
}

import { describe, expect, it } from "vitest";

import {
  officialSeedanceModelIds,
  getSeedanceModelProfile,
  resolveSeedanceTarget,
  seedanceModelProfiles,
  validateSeedanceSelection,
  type OfficialSeedanceModelId,
  type GenerationMode,
} from "@/lib/video/models";

const profileExpectations: Array<{
  id: OfficialSeedanceModelId;
  minDuration: number;
  maxDuration: number;
  resolutions: readonly string[];
  maxGeneralReferenceImages: number;
}> = [
  {
    id: "doubao-seedance-2-5-260628",
    minDuration: 4,
    maxDuration: 30,
    resolutions: ["480p", "720p", "1080p"],
    maxGeneralReferenceImages: 30,
  },
  {
    id: "doubao-seedance-2-0-260128",
    minDuration: 4,
    maxDuration: 15,
    resolutions: ["480p", "720p", "1080p", "4k"],
    maxGeneralReferenceImages: 9,
  },
  {
    id: "doubao-seedance-2-0-fast-260128",
    minDuration: 4,
    maxDuration: 15,
    resolutions: ["480p", "720p"],
    maxGeneralReferenceImages: 9,
  },
  {
    id: "doubao-seedance-2-0-mini-260615",
    minDuration: 4,
    maxDuration: 15,
    resolutions: ["480p", "720p"],
    maxGeneralReferenceImages: 9,
  },
];

const validSelection = {
  duration: 5,
  resolution: "720p",
  aspectRatio: "16:9",
  generationMode: "reference" as GenerationMode,
  referenceImageCount: 0,
};

describe("Seedance capability registry", () => {
  it("contains the four official model IDs and verified source metadata", () => {
    expect(officialSeedanceModelIds).toEqual(profileExpectations.map(({ id }) => id));
    expect(seedanceModelProfiles).toHaveLength(4);

    for (const profile of seedanceModelProfiles) {
      expect(profile.sourceUrl).toBe("https://www.volcengine.com/docs/82379/1520757?lang=zh");
      expect(profile.verifiedAt).toBe("2026-09-20");
      expect(profile.id).toBe(profile.model);
      expect(profile.label).not.toBe(profile.id);
    }
  });

  it.each(profileExpectations)(
    "$id exposes its duration, resolution, and general-reference limits",
    ({ id, minDuration, maxDuration, resolutions, maxGeneralReferenceImages }) => {
      const profile = getSeedanceModelProfile(id);

      expect(profile).toBeDefined();
      expect(profile).toMatchObject({
        minDuration,
        maxDuration,
        resolutions,
        maxGeneralReferenceImages,
      });
      expect(profile?.aspectRatios).toEqual([
        "adaptive",
        "21:9",
        "16:9",
        "9:16",
        "4:3",
        "1:1",
        "3:4",
      ]);
    },
  );

  it("accepts adaptive and 21:9 selections", () => {
    const profile = getSeedanceModelProfile("doubao-seedance-2-5-260628")!;

    expect(validateSeedanceSelection(profile, {
      ...validSelection,
      aspectRatio: "adaptive",
    })).toEqual({ ok: true });
    expect(validateSeedanceSelection(profile, {
      ...validSelection,
      aspectRatio: "21:9",
    })).toEqual({ ok: true });
  });

  it("keeps 2.5 native frame modes adaptive-only without restricting ordinary references", () => {
    const profile25 = getSeedanceModelProfile("doubao-seedance-2-5-260628")!;
    const profile20 = getSeedanceModelProfile("doubao-seedance-2-0-260128")!;

    expect(profile25.modeCapabilities["first-frame"].aspectRatios).toEqual(["adaptive"]);
    expect(profile25.modeCapabilities["first-last"].aspectRatios).toEqual(["adaptive"]);
    expect(profile25.modeCapabilities.reference.aspectRatios).toContain("21:9");
    expect(profile25.modeCapabilities["ordered-reference"].aspectRatios).toContain("21:9");

    expect(validateSeedanceSelection(profile25, {
      ...validSelection,
      generationMode: "first-frame",
      referenceImageCount: 1,
      aspectRatio: "16:9",
    }).ok).toBe(false);
    expect(validateSeedanceSelection(profile25, {
      ...validSelection,
      generationMode: "first-frame",
      referenceImageCount: 1,
      aspectRatio: "adaptive",
    }).ok).toBe(true);
    expect(validateSeedanceSelection(profile25, {
      ...validSelection,
      generationMode: "first-last",
      referenceImageCount: 2,
      aspectRatio: "21:9",
    }).ok).toBe(false);
    expect(validateSeedanceSelection(profile25, {
      ...validSelection,
      generationMode: "reference",
      referenceImageCount: 0,
      aspectRatio: "21:9",
    }).ok).toBe(true);
    expect(validateSeedanceSelection(profile20, {
      ...validSelection,
      generationMode: "first-frame",
      referenceImageCount: 1,
      aspectRatio: "16:9",
    }).ok).toBe(true);
  });

  it("requires references for ordered and native frame modes", () => {
    const profile = getSeedanceModelProfile("doubao-seedance-2-5-260628")!;

    expect(validateSeedanceSelection(profile, {
      ...validSelection,
      generationMode: "ordered-reference",
      referenceImageCount: 0,
    }).ok).toBe(false);
    expect(validateSeedanceSelection(profile, {
      ...validSelection,
      generationMode: "first-frame",
      referenceImageCount: 0,
    }).ok).toBe(false);
    expect(validateSeedanceSelection(profile, {
      ...validSelection,
      generationMode: "first-last",
      referenceImageCount: 1,
    }).ok).toBe(false);
  });

  it("accepts a profile's boundary values but rejects values beyond its capabilities", () => {
    for (const { id, minDuration, maxDuration, resolutions, maxGeneralReferenceImages } of profileExpectations) {
      const profile = getSeedanceModelProfile(id)!;
      const base = {
        ...validSelection,
        duration: minDuration,
        resolution: resolutions[0],
        referenceImageCount: maxGeneralReferenceImages,
      };

      expect(validateSeedanceSelection(profile, base)).toEqual({ ok: true });
      expect(validateSeedanceSelection(profile, { ...base, duration: maxDuration })).toEqual({ ok: true });
      expect(validateSeedanceSelection(profile, {
        ...base,
        duration: maxDuration + 1,
      }).ok).toBe(false);
      expect(validateSeedanceSelection(profile, {
        ...base,
        resolution: "1080p",
      }).ok).toBe(profile.resolutions.includes("1080p"));
      expect(validateSeedanceSelection(profile, {
        ...base,
        referenceImageCount: maxGeneralReferenceImages + 1,
      }).ok).toBe(false);
    }
  });

  it("infers an official model's own profile and rejects conflicts", () => {
    const official = "doubao-seedance-2-5-260628" as const;

    expect(resolveSeedanceTarget(official)).toMatchObject({
      model: official,
      modelProfile: official,
      profile: expect.objectContaining({ id: official }),
      isCustomEndpoint: false,
    });
    expect(resolveSeedanceTarget(official, official)).toBeDefined();
    expect(resolveSeedanceTarget(official, "doubao-seedance-2-0-260128")).toBeUndefined();
  });

  it.each([
    "ep-",
    "ep custom-endpoint",
    "endpoint-123",
    "EP-123",
    "ep-123/child",
  ])("rejects an Endpoint that does not use the exact ep-… syntax: %s", (model) => {
    expect(resolveSeedanceTarget(model, "doubao-seedance-2-5-260628")).toBeUndefined();
  });

  it("requires a supported official profile for a custom Endpoint", () => {
    expect(resolveSeedanceTarget("ep-project-video-123", undefined)).toBeUndefined();

    expect(resolveSeedanceTarget(
      "ep-project-video-123",
      "doubao-seedance-2-0-fast-260128",
    )).toMatchObject({
      model: "ep-project-video-123",
      modelProfile: "doubao-seedance-2-0-fast-260128",
      isCustomEndpoint: true,
    });
  });

  it("rejects arbitrary model strings", () => {
    expect(resolveSeedanceTarget("seedance-unknown-model")).toBeUndefined();
    expect(resolveSeedanceTarget("seedance-unknown-model", "not-a-profile" as OfficialSeedanceModelId)).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";

import {
  fingerprintSeedanceApiKey,
  isTaskKeyFingerprint,
} from "@/lib/client/api-key-fingerprint";

describe("API key fingerprint", () => {
  it("hashes the normalized key to a lowercase SHA-256 digest", async () => {
    expect(await fingerprintSeedanceApiKey(" abc ")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(await fingerprintSeedanceApiKey("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it.each(["", "a".repeat(63), "A".repeat(64), "g".repeat(64)])(
    "rejects invalid digest %s", (value) => {
      expect(isTaskKeyFingerprint(value)).toBe(false);
    },
  );

  it("accepts only a full lowercase hex digest", () => {
    expect(isTaskKeyFingerprint("a".repeat(64))).toBe(true);
  });
});

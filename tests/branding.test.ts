import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const layoutSource = readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

describe("品牌注入清理", () => {
  it("不加载或引用第三方品牌资源", () => {
    const source = `${layoutSource}\n${stylesSource}`.toLowerCase();
    expect(source).not.toContain("brand-banner.js");
    expect(source).not.toMatch(/<script[\s\S]*data-[\w-]+-app-id/);
  });
});

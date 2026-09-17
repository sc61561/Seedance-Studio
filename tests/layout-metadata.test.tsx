import { Children, isValidElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";

import RootLayout, { metadata, viewport } from "@/app/layout";
import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register";

function containsElementType(node: ReactNode, type: unknown): boolean {
  if (!isValidElement<{ children?: ReactNode }>(node)) return false;
  if (node.type === type) return true;
  return Children.toArray(node.props.children).some((child) =>
    containsElementType(child, type),
  );
}

describe("root PWA metadata", () => {
  it("publishes install and iOS standalone metadata without losing safe-area viewport support", () => {
    expect(metadata).toEqual(
      expect.objectContaining({
        manifest: "/manifest.webmanifest",
        appleWebApp: {
          capable: true,
          title: "Seedance Studio",
          statusBarStyle: "default",
        },
        icons: expect.objectContaining({
          apple: "/icons/icon-192.png",
        }),
      }),
    );
    expect(viewport).toEqual(
      expect.objectContaining({
        width: "device-width",
        initialScale: 1,
        viewportFit: "cover",
        themeColor: "#111111",
      }),
    );
  });

  it("mounts service-worker registration at the application root", () => {
    const tree = RootLayout({ children: <main>内容</main> });

    expect(containsElementType(tree, ServiceWorkerRegister)).toBe(true);
  });
});

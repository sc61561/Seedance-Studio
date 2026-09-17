import { readFileSync } from "node:fs";
import vm from "node:vm";

import { describe, expect, it, vi } from "vitest";

type ServiceWorkerHandler = (event: Record<string, unknown>) => void;

function loadServiceWorker() {
  const handlers = new Map<string, ServiceWorkerHandler>();
  const cache = {
    addAll: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue(undefined),
  };
  const cacheStorage = {
    delete: vi.fn().mockResolvedValue(true),
    keys: vi.fn().mockResolvedValue([]),
    match: vi.fn().mockResolvedValue(undefined),
    open: vi.fn().mockResolvedValue(cache),
  };
  const fetchMock = vi.fn();
  const self = {
    addEventListener: (type: string, handler: ServiceWorkerHandler) => {
      handlers.set(type, handler);
    },
    clients: { claim: vi.fn().mockResolvedValue(undefined) },
    location: { origin: "https://studio.test" },
    skipWaiting: vi.fn().mockResolvedValue(undefined),
  };

  const source = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  vm.runInNewContext(source, {
    URL,
    caches: cacheStorage,
    console,
    fetch: fetchMock,
    self,
  });

  return { cache, cacheStorage, fetchMock, handlers, self };
}

function request(url: string, overrides: Record<string, unknown> = {}) {
  return {
    destination: "",
    headers: new Headers(),
    method: "GET",
    mode: "cors",
    url,
    ...overrides,
  };
}

describe("service worker", () => {
  it("pre-caches only the public offline shell and install assets", async () => {
    const { cache, handlers } = loadServiceWorker();
    let installed: Promise<unknown> | undefined;

    handlers.get("install")?.({
      waitUntil: (value: Promise<unknown>) => {
        installed = value;
      },
    });
    await installed;

    expect(cache.addAll).toHaveBeenCalledWith([
      "/offline.html",
      "/manifest.webmanifest",
      "/icons/icon-192.png",
      "/icons/icon-512.png",
      "/icons/icon-maskable-512.png",
    ]);
  });

  it.each([
    ["API polling", request("https://studio.test/api/task/task-1")],
    ["API root", request("https://studio.test/api")],
    ["upload API", request("https://studio.test/api/upload")],
    ["auth API", request("https://studio.test/api/auth/login")],
    [
      "authorized static request",
      request("https://studio.test/_next/static/app.js", {
        destination: "script",
        headers: new Headers({ authorization: "Bearer secret" }),
      }),
    ],
    ["non-GET", request("https://studio.test/", { method: "POST" })],
    ["remote video", request("https://cdn.example.com/video.mp4", { destination: "video" })],
    ["Data URL", request("data:video/mp4;base64,AAAA", { destination: "video" })],
  ])("leaves %s entirely on the network", (_label, unsafeRequest) => {
    const { handlers } = loadServiceWorker();
    const respondWith = vi.fn();

    handlers.get("fetch")?.({ request: unsafeRequest, respondWith });

    expect(respondWith).not.toHaveBeenCalled();
  });

  it("serves a cached same-origin static asset without a network request", async () => {
    const cached = new Response("cached", { status: 200 });
    const { cacheStorage, fetchMock, handlers } = loadServiceWorker();
    cacheStorage.match.mockResolvedValue(cached);
    let response: Promise<Response> | undefined;

    handlers.get("fetch")?.({
      request: request("https://studio.test/_next/static/app.js", {
        destination: "script",
      }),
      respondWith: (value: Promise<Response>) => {
        response = value;
      },
    });

    await expect(response).resolves.toBe(cached);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["private", new Headers({ "cache-control": "private" })],
    ["no-store", new Headers({ "cache-control": "no-store" })],
    ["video", new Headers({ "content-type": "video/mp4" })],
  ])("never stores a %s response", async (_label, headers) => {
    const networkResponse = new Response("network", { status: 200, headers });
    const { cache, fetchMock, handlers } = loadServiceWorker();
    fetchMock.mockResolvedValue(networkResponse);
    let response: Promise<Response> | undefined;

    handlers.get("fetch")?.({
      request: request("https://studio.test/_next/static/app.js", {
        destination: "script",
      }),
      respondWith: (value: Promise<Response>) => {
        response = value;
      },
    });

    await expect(response).resolves.toBe(networkResponse);
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("falls back to the public offline shell without caching authenticated pages", async () => {
    const offline = new Response("offline", { status: 200 });
    const { cache, cacheStorage, fetchMock, handlers } = loadServiceWorker();
    fetchMock.mockRejectedValue(new TypeError("offline"));
    cacheStorage.match.mockResolvedValue(offline);
    let response: Promise<Response> | undefined;

    handlers.get("fetch")?.({
      request: request("https://studio.test/", {
        destination: "document",
        mode: "navigate",
      }),
      respondWith: (value: Promise<Response>) => {
        response = value;
      },
    });

    await expect(response).resolves.toBe(offline);
    expect(cacheStorage.match).toHaveBeenCalledWith("/offline.html");
    expect(cache.put).not.toHaveBeenCalled();
  });
});

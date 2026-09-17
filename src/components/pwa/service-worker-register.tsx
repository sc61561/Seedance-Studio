"use client";

import { useEffect } from "react";

type ServiceWorkerRegistrar = {
  register: (
    scriptURL: string | URL,
    options?: RegistrationOptions,
  ) => Promise<unknown>;
};

function browserServiceWorkers(): ServiceWorkerRegistrar | undefined {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return undefined;
  }

  return navigator.serviceWorker;
}

export async function registerSeedanceServiceWorker(
  serviceWorkers: ServiceWorkerRegistrar | undefined = browserServiceWorkers(),
): Promise<boolean> {
  if (!serviceWorkers) return false;

  try {
    await serviceWorkers.register("/sw.js", { scope: "/" });
    return true;
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.debug("Seedance Studio service worker registration failed", error);
    }
    return false;
  }
}

export function ServiceWorkerRegister() {
  useEffect(() => {
    void registerSeedanceServiceWorker();
  }, []);

  return null;
}

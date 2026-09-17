import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register";
import { I18nProvider } from "@/lib/i18n/context";

export const metadata: Metadata = {
  title: "Seedance Studio",
  description: "Seedance 视频生成工作台 / Seedance video generation studio",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Seedance Studio",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/icon-192.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#111111",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="zh-CN"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">
        <ServiceWorkerRegister />
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}

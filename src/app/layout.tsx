import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Seedance Studio",
  description: "Seedance 视频生成工作台",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh-CN"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

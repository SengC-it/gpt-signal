import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GPT Signal",
  description: "专业虚拟货币合约交易机会雷达与风控复盘系统"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}


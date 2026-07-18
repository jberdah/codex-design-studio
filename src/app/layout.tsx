import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Codex Design Studio", description: "One executable brand system. Every deliverable." };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}

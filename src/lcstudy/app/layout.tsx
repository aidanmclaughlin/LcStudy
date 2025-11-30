/**
 * Root layout for the application.
 *
 * Provides:
 * - Global CSS imports
 * - NextAuth session provider
 * - HTML lang attribute
 * - Theme color meta tag
 */

import type { Metadata, Viewport } from "next";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "LcStudy",
  description: "Predict Leela's move from any device"
};

export const viewport: Viewport = {
  themeColor: "#0f172a"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

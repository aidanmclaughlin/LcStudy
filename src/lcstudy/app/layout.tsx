import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import { clsx } from "clsx";

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
      <body
        className={clsx(
          "bg-background text-slate-100",
          "min-h-screen"
        )}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Agent Arcade — Universal Agent Visualizer",
  description:
    "A world-class, plug-and-play agent visualization platform. Watch your AI agents think, read, write, and collaborate in a pixel-art office — embeddable anywhere.",
  keywords: [
    "agent arcade",
    "AI agents",
    "visualization",
    "telemetry",
    "pixel art",
    "real-time",
    "embed",
  ],
  openGraph: {
    title: "Agent Arcade",
    description: "Universal Agent Visualizer — pixel-art AI telemetry",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "gloss — a dictionary",
  description: "A dead-simple dictionary for everyone, everywhere. Powered by Open English WordNet.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "gloss",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  // Belt and suspenders: Next emits the standardized mobile-web-app-capable;
  // older iOS still wants the apple- prefixed variant for standalone mode.
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  themeColor: "#178A4C",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

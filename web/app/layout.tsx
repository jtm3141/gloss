import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "gloss — a dictionary",
  description: "A dead-simple dictionary for everyone, everywhere. Powered by Open English WordNet.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

import type { Viewport } from "next";

// The Ray-Ban Display lens is a fixed 600x600 viewport.
export const viewport: Viewport = { width: 600, initialScale: 1 };

export default function GlassesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

/** @type {import('next').NextConfig} */
const isDesktop = process.env.NEXT_PUBLIC_GLOSS_TARGET === "desktop";
const nextConfig = {
  // Desktop (Electron file:// shell) needs a fully static export with the
  // dictionary bundled in the browser (sql.js). The server flavor (Vercel)
  // keeps API routes and must NOT set output: "export".
  ...(isDesktop ? { output: "export" } : {}),
  // Dev-only convenience: internal links use the static-export filenames
  // (license.html, index.html), which the Electron file:// shell also needs.
  // next dev serves the routes as /license and /, so rewrite them there.
  // The static export has no server and ships the real .html files, so these
  // are ignored at export time.
  async rewrites() {
    return [
      { source: "/license.html", destination: "/license" },
      { source: "/index.html", destination: "/" },
    ];
  },
};
module.exports = nextConfig;

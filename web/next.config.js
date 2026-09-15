/** @type {import('next').NextConfig} */
const nextConfig = {
  // Fully static: no server. The dictionary lives in the browser (sql.js).
  output: "export",
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

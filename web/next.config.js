/** @type {import('next').NextConfig} */
const nextConfig = {
  // Fully static: no server. The dictionary lives in the browser (sql.js).
  output: "export",
  // Dev-only convenience: the footer links to license.html (the static-export
  // filename, which the Electron file:// shell also needs). next dev serves
  // the route as /license, so rewrite it there. The static export has no
  // server and ships a real license.html, so this is ignored at export time.
  async rewrites() {
    return [{ source: "/license.html", destination: "/license" }];
  },
};
module.exports = nextConfig;

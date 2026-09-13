/** @type {import('next').NextConfig} */
const nextConfig = {
  // Fully static: no server. The dictionary lives in the browser (sql.js).
  output: "export",
};
module.exports = nextConfig;

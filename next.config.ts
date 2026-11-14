import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Genera un bundle ligero auto-contenido ideal para contenedores en Google Cloud Run
  output: "standalone",
  cacheComponents: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

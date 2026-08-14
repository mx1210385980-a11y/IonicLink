const distDir = process.env.NEXT_DIST_DIR?.trim() || ".next";

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir,
  reactStrictMode: true,
  // Native modules — keep them external to the server bundle.
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3", "@napi-rs/canvas", "unpdf"],
  },
  webpack: (config, { isServer }) => {
    config.externals = [...(config.externals || []), "better-sqlite3", "@napi-rs/canvas"];
    // Ketcher is client-only. Avoid following Paper.js' optional Node adapter
    // while still bundling Paper.js into the browser editor.
    if (isServer) config.externals.push("paper");
    return config;
  },
};

export default nextConfig;

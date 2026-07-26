const distDir = process.env.NEXT_DIST_DIR?.trim() || ".next";

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir,
  reactStrictMode: true,
  // Native modules — keep them external to the server bundle.
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3", "@napi-rs/canvas", "unpdf"],
  },
  webpack: (config) => {
    config.externals = [...(config.externals || []), "better-sqlite3", "@napi-rs/canvas"];
    return config;
  },
};

export default nextConfig;

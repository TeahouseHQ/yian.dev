const withBundleAnalyzer = require("@next/bundle-analyzer")({
  // Opt-in via `pnpm analyze` (ANALYZE=true); stays off for normal builds
  // so it never blocks CI or adds the webpack-bundle-analyzer plugin.
  enabled: process.env.ANALYZE === "true",
});

/**
 * @type {import('next').NextConfig}
 */

const COOP_COEP_HEADERS = [
  {
    key: "Cross-Origin-Opener-Policy",
    value: "same-origin",
  },
  {
    key: "Cross-Origin-Embedder-Policy",
    value: "require-corp",
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: "/play/g/:path*",
        headers: COOP_COEP_HEADERS,
      },
      {
        source: "/assets/js/:path*",
        headers: COOP_COEP_HEADERS,
      },
    ];
  },
};

module.exports = withBundleAnalyzer(nextConfig);

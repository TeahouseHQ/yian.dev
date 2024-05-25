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

module.exports = {
  async headers() {
    return [
      {
        source: "/play/g/:path*",
        headers: COOP_COEP_HEADERS,
      },
    ];
  },
};

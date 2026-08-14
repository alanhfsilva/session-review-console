import type { NextConfig } from "next";

// The API keeps its own variable (API_PORT) so that PORT, which launchers hand
// to the web server, can never pull the API out from under these rewrites.
const apiPort = process.env.API_PORT ?? "4001";

const nextConfig: NextConfig = {
  // The floating dev badge overlaps the note actions on small screens.
  devIndicators: false,
  // Same-origin proxy to the API: the session cookie stays first-party and the
  // browser never talks to a second origin.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `http://127.0.0.1:${apiPort}/api/:path*` }];
  },
  // Clinical data must not be cached by intermediaries or held in bfcache.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;

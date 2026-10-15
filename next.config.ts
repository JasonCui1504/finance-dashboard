import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // libSQL ships native bindings that must not be bundled.
  serverExternalPackages: ["@libsql/client", "libsql"],
};

export default nextConfig;

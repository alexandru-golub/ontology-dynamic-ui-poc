import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["neo4j-driver", "@neo4j/graphql", "graphql"],
};

export default nextConfig;

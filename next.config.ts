import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // FR-018: 완전 정적 export — 서버 코드 없음 (specs/001-penguin-party/research.md R2)
  output: "export",
};

export default nextConfig;

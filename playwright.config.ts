import { defineConfig, devices } from "@playwright/test";

// 전용 포트 — 3000은 다른 프로젝트 dev 서버, 3311은 Docker 포워딩과 충돌 실측.
// reuse가 엉뚱한 앱을 잡지 않도록 흔치 않은 포트를 쓴다
const PORT = process.env.PLAYWRIGHT_PORT ?? "3419";
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  use: { baseURL: BASE_URL },
  projects: [
    { name: "host-desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "player-mobile", use: { ...devices["iPhone 13"] } },
  ],
  webServer: {
    command: `next dev -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});

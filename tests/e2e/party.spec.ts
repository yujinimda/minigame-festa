// E2E 스모크 — 호스트 1 + 플레이어 2로 참가→레이스→순위→다시 하기까지 한 판 완주.
// 실 PeerJS Cloud 시그널링 + 실 WebRTC(chromium)를 그대로 쓴다.
// 컨텍스트는 이 스펙이 직접 만든다(데스크톱/모바일) — 실행 프로젝트의 use.* 에 의존하지 않음.

import { expect, test, devices, type Page } from "@playwright/test";

const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ??
  `http://localhost:${process.env.PLAYWRIGHT_PORT ?? "3419"}`; // playwright.config.ts와 동일 규칙

// 방 코드 알파벳: abcdefghjkmnpqrstuvwxyz23456789 (host-room.ts ROOM_CODE_ALPHABET)
const ROOM_CODE_RE = /mgf-[a-z2-9]{6}/;

const SIGNALING_TIMEOUT = 20_000; // 시그널링(PeerJS Cloud) open 까지
const JOIN_TIMEOUT = 25_000; // 시그널링 + ICE + join 왕복
const RACE_END_TIMEOUT = 40_000; // 카운트다운 3s + 레이스 30s + 집계 여유

/**
 * 왼발/오른발을 번갈아 탭한다. MIN_TAP_INTERVAL_MS(60ms)보다 긴 간격으로,
 * 페이지 안에서 연속 디스패치해 왕복 지연이 타이밍을 흔들지 않게 한다.
 */
const tapAlternating = async (page: Page, count: number, gapMs = 85): Promise<number> =>
  page.evaluate(
    async ({ count, gapMs }) => {
      const left = document.querySelector<HTMLButtonElement>('[aria-label="왼발"]');
      const right = document.querySelector<HTMLButtonElement>('[aria-label="오른발"]');
      if (!left || !right) throw new Error("컨트롤러 버튼을 찾지 못했습니다");
      let dispatched = 0;
      for (let i = 0; i < count; i += 1) {
        const target = i % 2 === 0 ? left : right;
        target.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true, cancelable: true, composed: true }),
        );
        dispatched += 1;
        await new Promise((resolve) => setTimeout(resolve, gapMs));
      }
      return dispatched;
    },
    { count, gapMs },
  );

test("호스트 + 플레이어 2명: 참가 → 레이스 → 순위 → 다시 하기", async ({ browser }) => {
  test.setTimeout(120_000);

  const hostContext = await browser.newContext({ ...devices["Desktop Chrome"] });
  const playerAContext = await browser.newContext({ ...devices["iPhone 13"] });
  const playerBContext = await browser.newContext({ ...devices["iPhone 13"] });

  try {
    // ── 1. 호스트가 방을 열고 방 코드가 화면에 뜬다 ──────────────────
    const hostPage = await hostContext.newPage();
    const hostResponse = await hostPage.goto(`${BASE_URL}/host`);
    // 포트 선점 진단: playwright.config.ts의 webServer는 reuseExistingServer라
    // 3000번을 다른 앱이 잡고 있으면 그 앱을 그대로 재사용해 버린다.
    // 다른 포트로 띄웠다면 PLAYWRIGHT_BASE_URL로 지정한다.
    expect(
      hostResponse?.status(),
      `${BASE_URL}/host 가 이 앱을 서빙하지 않습니다 — 다른 프로세스가 포트를 선점했는지 확인하고, ` +
        `필요하면 PLAYWRIGHT_BASE_URL=http://localhost:<port> 로 지정하세요`,
    ).toBe(200);

    const roomCodeLine = hostPage.getByText(/방 코드:/);
    await expect(roomCodeLine).toBeVisible({ timeout: SIGNALING_TIMEOUT });

    const roomCode = (await roomCodeLine.innerText()).match(ROOM_CODE_RE)?.[0];
    expect(roomCode, "호스트 화면에서 mgf-xxxxxx 방 코드를 읽지 못했습니다").toBeTruthy();

    // ── 2. 모바일 플레이어 2명이 방 코드로 입장한다 ──────────────────
    const joinUrl = `${BASE_URL}/play?room=${roomCode}`;

    const playerA = await playerAContext.newPage();
    const playerB = await playerBContext.newPage();

    const join = async (page: Page, nickname: string) => {
      await page.goto(joinUrl);
      await expect(page.getByText(`방 코드: ${roomCode}`)).toBeVisible();
      await page.getByLabel("닉네임").fill(nickname);
      // 실제 클릭이어야 사용자 제스처로 인정된다(unlockAudio → join 경로)
      await page.getByRole("button", { name: /입장하기/ }).click();
    };

    await join(playerA, "펭수A");
    await join(playerB, "펭수B");

    // ── 3. 호스트 로비에 두 닉네임 → 시작 ─────────────────────────
    await expect(hostPage.getByText("펭수A")).toBeVisible({ timeout: JOIN_TIMEOUT });
    await expect(hostPage.getByText("펭수B")).toBeVisible({ timeout: JOIN_TIMEOUT });

    // 두 플레이어 모두 컨트롤러 대기 화면까지 도달했는지 확인(joined)
    await expect(playerA.getByText(/호스트가 시작하면/)).toBeVisible({ timeout: JOIN_TIMEOUT });
    await expect(playerB.getByText(/호스트가 시작하면/)).toBeVisible({ timeout: JOIN_TIMEOUT });

    const startButton = hostPage.getByRole("button", { name: "게임 시작!" });
    await expect(startButton).toBeEnabled({ timeout: JOIN_TIMEOUT });

    // ── 4. 온보딩(카운트다운) 노출 → 사라짐 = 레이스 시작 ────────────
    // 카운트다운은 3초뿐이라 클릭 전에 폴링을 걸어 놓아야 노출 순간을 놓치지 않는다
    const onboardingA = playerA.getByText(/번갈아/);
    const onboardingVisible = expect(onboardingA).toBeVisible({ timeout: 15_000 });
    await startButton.click();
    await onboardingVisible;
    await expect(onboardingA).toBeHidden({ timeout: 15_000 });

    // ── 5. A는 20회 번갈아 탭, B는 5회만 ─────────────────────────
    expect(await tapAlternating(playerB, 5)).toBe(5);
    expect(await tapAlternating(playerA, 20)).toBe(20);

    // A가 더 많이 걸었다 — 컨트롤러 헤더의 거리 표시로 즉시 확인
    await expect(playerA.getByText(/^20보$/)).toBeVisible();

    // ── 6. 레이스 종료 후 순위 ──────────────────────────────────
    await expect(hostPage.getByTestId("rank-1")).toBeVisible({ timeout: RACE_END_TIMEOUT });
    await expect(hostPage.getByTestId("rank-1")).toContainText("펭수A");
    await expect(hostPage.getByTestId("rank-2")).toContainText("펭수B");

    await expect(playerA.getByTestId("my-rank")).toHaveText("1위", { timeout: 15_000 });
    await expect(playerB.getByTestId("my-rank")).toHaveText("2위", { timeout: 15_000 });

    // ── 7. 다시 하기 → 호스트가 로비(QR/방 코드)로 복귀 ──────────────
    await hostPage.getByRole("button", { name: /다시 하기/ }).click();

    await expect(hostPage.getByLabel("참가 QR 코드")).toBeVisible({ timeout: 15_000 });
    await expect(hostPage.getByText(`방 코드: ${roomCode}`)).toBeVisible();
    await expect(hostPage.getByText("펭수A")).toBeVisible();
  } finally {
    await Promise.all([hostContext.close(), playerAContext.close(), playerBContext.close()]);
  }
});

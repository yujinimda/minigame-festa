/**
 * US2 컨트롤러 컨테이너 계약 테스트 (TDD — 구현 이전에 작성. 현재 컨테이너는 스텁이므로 전부 실패한다)
 *
 * 대상: src/components/play/ControllerContainer.tsx (default export, props { session })
 *
 * 근거 매핑
 * - FR-007 (US2-AS1): 게임 시작 시 좌/우 두 버튼의 컨트롤러 화면
 *   → "좌/우 대형 버튼 두 개를...", "레이스 전 온보딩...", "racing으로 전환되면..."
 * - FR-008 (US2-AS2): 좌/우 교대 탭 → 전진
 *   → "왼발 탭은 side \"L\"로...", "오른발 탭은 side \"R\"로..."
 * - FR-011 (US2-AS4): abs(tilt) >= TILT_LIMIT → 넘어짐 + 기록 확정 + 폰에 피드백
 *   → "넘어짐 판정이 나오면 reportFall...", "넘어짐 피드백 문구...", "넘어진 뒤 버튼 탭은..."
 * - FR-013: 판정은 참가자 기기, 호스트에는 상태만 전송
 *   → "탭 직후 pushState가 최신 판정 상태로..."
 * - data-model.md §PlayerRaceState(tilt는 원시값, 표시용 클램프는 UI 소관)
 *   → "기울기 게이지가 존재한다", "TILT_LIMIT를 초과한 기울기도 표시값은 ±TILT_LIMIT로..."
 *
 * 범위
 * - US2가 소유하는 컨트롤러 컨테이너만 검증한다. 호스트 Phaser 레이스 뷰(FR-014)는 E2E 소관이라 제외.
 * - 판정 엔진(src/game/penguin.ts)은 목킹한다 — 여기서 고정하는 것은 "컨테이너가 엔진을
 *   어떤 side/시점으로 호출하고 결과를 어떻게 UI·전송에 반영하는가"뿐이다.
 *   엔진 자체의 수치 계약은 tests/unit/game/penguin.test.ts 소관.
 * - 검증 표면은 공개 props(session) + 화면 텍스트/role/aria-label로 한정한다. 내부 state·구현 함수 접근 금지.
 * - 상수는 balance.ts에서 import한다(숫자 하드코딩 금지).
 * - 타이머/rAF 조작은 필요하지 않다(탭은 사용자 이벤트, 비동기 반영은 waitFor로 흡수).
 *   드리프트 루프(FR-010)는 시간 기반이라 이 파일에서 고정하지 않는다 — applyDrift는 항등 목으로 둔다.
 */

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TPlayerSession } from "@/src/components/shared/usePlayerSession";
import { TILT_LIMIT } from "@/src/game/balance";
import type { TPenguinRaceState } from "@/src/game/penguin";
import type { TPlayerStatus } from "@/src/p2p/player-client";
import type { TSide } from "@/src/p2p/protocol";
import { usePlayerStore } from "@/src/stores/player-store";

// ── 목킹 (F 소유 모듈) ──────────────────────────────────────────────

const penguin = vi.hoisted(() => ({
  createRaceState: vi.fn(),
  applyTap: vi.fn(),
  applyDrift: vi.fn(),
}));

vi.mock("@/src/game/penguin", () => penguin);

vi.mock("@/src/audio/sound", () => ({
  unlockAudio: vi.fn(async () => true),
  isAudioUnlocked: vi.fn(() => true),
  playSfx: vi.fn(),
  vibrate: vi.fn(() => true),
  startBgm: vi.fn(),
  stopBgm: vi.fn(),
}));

import PlayControllerContainer from "@/src/components/play/ControllerContainer";

// ── 픽스처 ─────────────────────────────────────────────────────────

/** 판정 상태 픽스처 — 목이 반환할 값을 테스트가 직접 만든다 */
const raceState = (overrides: Partial<TPenguinRaceState> = {}): TPenguinRaceState => ({
  distance: 0,
  tilt: 0,
  fallen: false,
  distanceReachedAt: null,
  finishedAt: null,
  seq: 0,
  lastSide: null,
  lastTapAt: null,
  driftDirection: 1,
  ...overrides,
});

/** 가짜 player-client 핸들 — core는 컨테이너가 읽을 수 있는 최소 표면만 채운다 */
const createFakeClient = () => ({
  core: {
    handleHostMsg: vi.fn(),
    tick: vi.fn(),
    reportFall: vi.fn(),
    getStatus: vi.fn(() => usePlayerStore.getState().status),
    getRaceId: vi.fn(() => 1),
    raceElapsed: vi.fn(() => 0),
    getSnapshot: vi.fn(() => null),
    getResults: vi.fn(() => null),
    getRoster: vi.fn(() => []),
    getNickname: vi.fn(() => "지니"),
  },
  pushState: vi.fn(),
  reportFall: vi.fn(),
  destroy: vi.fn(),
});

const INITIAL_STORE = usePlayerStore.getState();

const renderController = (status: TPlayerStatus) => {
  usePlayerStore.setState({ ...INITIAL_STORE, screen: "game", status }, true);
  const client = createFakeClient();
  const session = { client, join: vi.fn() } as unknown as TPlayerSession;
  const view = render(<PlayControllerContainer session={session} />);
  return { ...view, client, session };
};

/** 탭 = 발 버튼 누름. 버튼이 없으면 즉시 실패해야 하는 자리에 쓴다 */
const tapFoot = async (user: UserEvent, name: "왼발" | "오른발"): Promise<void> => {
  await user.click(screen.getByRole("button", { name }));
};

/**
 * "눌러도 아무 일이 없어야 한다"를 검증하는 자리용 관용 탭.
 * 버튼 자체를 안 그리거나 disabled/pointer-events:none으로 막는 구현도 유효한 통과이므로 삼킨다.
 */
const tryTapFoot = async (user: UserEvent, name: "왼발" | "오른발"): Promise<void> => {
  const button = screen.queryByRole("button", { name });
  if (!button) return;
  try {
    await user.click(button);
  } catch {
    // 물리적으로 눌리지 않는 구현 = 입력 무시의 유효한 형태
  }
};

/** 기울기 게이지 — role="progressbar" 또는 data-testid="tilt-gauge" 중 하나로 노출 */
const getTiltGauge = (): HTMLElement => {
  const byRole = screen.queryByRole("progressbar");
  if (byRole) return byRole;
  const byTestId = screen.queryByTestId("tilt-gauge");
  if (byTestId) return byTestId;
  throw new Error(
    '기울기 게이지를 찾을 수 없다 — role="progressbar" 또는 data-testid="tilt-gauge"가 필요하다',
  );
};

const gaugeValue = (gauge: HTMLElement): number => {
  const raw = gauge.getAttribute("aria-valuenow");
  expect(raw, "게이지는 aria-valuenow로 현재 기울기를 노출해야 한다").not.toBeNull();
  const value = Number(raw);
  expect(Number.isNaN(value), `aria-valuenow가 숫자가 아니다: ${raw}`).toBe(false);
  return value;
};

beforeEach(() => {
  vi.clearAllMocks();
  usePlayerStore.setState({ ...INITIAL_STORE }, true);

  // 기본 목 동작: 전진 1스텝, 드리프트는 항등(같은 참조 반환 → 렌더 루프 방지)
  penguin.createRaceState.mockImplementation(() => raceState());
  penguin.applyDrift.mockImplementation((state: TPenguinRaceState) => state);
  penguin.applyTap.mockImplementation(
    (state: TPenguinRaceState, side: TSide, now: number) =>
      raceState({
        ...state,
        distance: state.distance + 1,
        lastSide: side,
        lastTapAt: now,
        distanceReachedAt: now,
      }),
  );
});

afterEach(() => {
  cleanup();
});

// ── 테스트 ─────────────────────────────────────────────────────────

describe("ControllerContainer — 컨트롤러 화면 구성 (FR-007)", () => {
  it("좌/우 대형 버튼 두 개를 왼발·오른발 레이블로 노출한다", () => {
    renderController("racing");

    expect(screen.getByRole("button", { name: "왼발" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "오른발" })).toBeInTheDocument();
  });

  it("레이스 전(countdown)에는 번갈아 누르라는 온보딩 카피를 보여준다", () => {
    renderController("countdown");

    expect(screen.getByText(/번갈아/)).toBeInTheDocument();
  });

  it("racing으로 전환되면 온보딩 카피가 사라진다", () => {
    renderController("countdown");
    expect(screen.getByText(/번갈아/)).toBeInTheDocument();

    act(() => {
      usePlayerStore.setState({ status: "racing" });
    });

    expect(screen.queryByText(/번갈아/)).not.toBeInTheDocument();
  });
});

describe("ControllerContainer — 탭 → 판정 엔진 위임 (FR-008)", () => {
  it('왼발 탭은 side "L"로 applyTap을 호출한다', async () => {
    const user = userEvent.setup();
    renderController("racing");

    await tapFoot(user, "왼발");

    expect(penguin.applyTap).toHaveBeenCalledTimes(1);
    expect(penguin.applyTap.mock.calls[0][1]).toBe("L");
  });

  it('오른발 탭은 side "R"로 applyTap을 호출한다', async () => {
    const user = userEvent.setup();
    renderController("racing");

    await tapFoot(user, "오른발");

    expect(penguin.applyTap).toHaveBeenCalledTimes(1);
    expect(penguin.applyTap.mock.calls[0][1]).toBe("R");
  });

  it("레이스 시작 전(countdown)에는 버튼을 눌러도 판정하지 않는다", async () => {
    const user = userEvent.setup();
    renderController("countdown");

    await tryTapFoot(user, "왼발");
    await tryTapFoot(user, "오른발");

    expect(penguin.applyTap).not.toHaveBeenCalled();
  });
});

describe("ControllerContainer — 호스트 전송 (FR-013)", () => {
  it("탭 직후 pushState를 최신 판정 상태로 호출한다", async () => {
    const user = userEvent.setup();
    penguin.applyTap.mockReturnValue(
      raceState({ distance: 3, tilt: 24, fallen: false, distanceReachedAt: 1_234 }),
    );
    const { client } = renderController("racing");

    await tapFoot(user, "왼발");

    await waitFor(() => expect(client.pushState).toHaveBeenCalled());
    expect(client.pushState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        distance: 3,
        tilt: 24,
        fallen: false,
        distanceReachedAt: 1_234,
      }),
    );
  });
});

describe("ControllerContainer — 넘어짐 (FR-011)", () => {
  const fallenState = raceState({
    distance: 5,
    tilt: TILT_LIMIT,
    fallen: true,
    distanceReachedAt: 900,
    finishedAt: 900,
  });

  it("넘어짐 판정이 나오면 reportFall을 한 번만 호출한다", async () => {
    const user = userEvent.setup();
    penguin.applyTap.mockReturnValue(fallenState);
    const { client } = renderController("racing");

    await tapFoot(user, "왼발");

    await waitFor(() => expect(client.reportFall).toHaveBeenCalledTimes(1));
    expect(client.reportFall).toHaveBeenCalledWith(
      expect.objectContaining({ distance: 5, fallen: true, distanceReachedAt: 900 }),
    );
  });

  it("넘어짐 피드백 문구를 화면에 표시한다", async () => {
    const user = userEvent.setup();
    penguin.applyTap.mockReturnValue(fallenState);
    renderController("racing");

    await tapFoot(user, "왼발");

    await waitFor(() => expect(screen.getByText(/꽈당|넘어/)).toBeInTheDocument());
  });

  it("넘어진 뒤 버튼을 더 눌러도 추가 판정하지 않는다", async () => {
    const user = userEvent.setup();
    penguin.applyTap.mockReturnValue(fallenState);
    const { client } = renderController("racing");

    await tapFoot(user, "왼발");
    await waitFor(() => expect(client.reportFall).toHaveBeenCalledTimes(1));

    penguin.applyTap.mockClear();
    await tryTapFoot(user, "오른발");
    await tryTapFoot(user, "왼발");

    expect(penguin.applyTap).not.toHaveBeenCalled();
    expect(client.reportFall).toHaveBeenCalledTimes(1);
  });
});

describe("ControllerContainer — 기울기 게이지 (표시용 클램프)", () => {
  it("레이스 중 기울기 게이지를 노출한다", () => {
    renderController("racing");

    expect(getTiltGauge()).toBeInTheDocument();
  });

  it("TILT_LIMIT를 넘는 양(+) 기울기도 표시값은 +TILT_LIMIT로 클램프한다", async () => {
    const user = userEvent.setup();
    penguin.applyTap.mockReturnValue(
      raceState({ distance: 2, tilt: TILT_LIMIT + 60, fallen: false, distanceReachedAt: 500 }),
    );
    renderController("racing");

    await tapFoot(user, "오른발");

    await waitFor(() => {
      expect(Math.abs(gaugeValue(getTiltGauge()))).toBeLessThanOrEqual(TILT_LIMIT);
    });
  });

  it("TILT_LIMIT를 넘는 음(−) 기울기도 표시값은 −TILT_LIMIT로 클램프한다", async () => {
    const user = userEvent.setup();
    penguin.applyTap.mockReturnValue(
      raceState({ distance: 2, tilt: -(TILT_LIMIT + 60), fallen: false, distanceReachedAt: 500 }),
    );
    renderController("racing");

    await tapFoot(user, "왼발");

    await waitFor(() => {
      const value = gaugeValue(getTiltGauge());
      expect(Math.abs(value)).toBeLessThanOrEqual(TILT_LIMIT);
      expect(value).toBeLessThan(0);
    });
  });
});

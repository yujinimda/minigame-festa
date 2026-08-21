// US3(순위 발표) UI 계약 테스트 — 컨테이너 2개(호스트 순위 / 개인 결과)만 대상.
// 구현은 아직 스텁이므로 전 케이스가 실패한다(RED). 검증은 공개 props + 화면 텍스트/role만 사용.

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import HostResultContainer from "@/src/components/host/ResultContainer";
import PersonalResultContainer from "@/src/components/play/PersonalResultContainer";
import type { TPlayerSession } from "@/src/components/shared/usePlayerSession";
import type { THostRoomHandle } from "@/src/p2p/host-room";
import type { TRaceResult } from "@/src/p2p/protocol";
import { useHostStore } from "@/src/stores/host-store";
import { usePlayerStore } from "@/src/stores/player-store";

// F 모듈(오디오)은 목킹 — US3 컨테이너가 효과음을 호출해도 테스트가 깨지지 않게.
vi.mock("@/src/audio/sound", () => ({
  unlockAudio: vi.fn(async () => true),
  isAudioUnlocked: vi.fn(() => true),
  playSfx: vi.fn(),
  vibrate: vi.fn(() => true),
  startBgm: vi.fn(),
  stopBgm: vi.fn(),
}));

// ── 가짜 핸들 ─────────────────────────────────────────────────────

const createFakeRoom = () => {
  const core = {
    join: vi.fn(),
    markDisconnected: vi.fn(),
    handleMessage: vi.fn(),
    startRace: vi.fn(),
    tick: vi.fn(),
    returnLobby: vi.fn(),
    getPhase: vi.fn(() => "result" as const),
    getRoster: vi.fn(() => []),
    getResults: vi.fn<() => TRaceResult[] | null>(() => null),
    getSnapshotFor: vi.fn(),
  };
  const handle = {
    getRoomId: () => "ABCD",
    core,
    destroy: vi.fn(),
  };
  return { handle: handle as unknown as THostRoomHandle, core };
};

const createFakeSession = (results: TRaceResult[] | null, nickname: string | null) => {
  const core = {
    getStatus: vi.fn(() => usePlayerStore.getState().status),
    getRaceId: vi.fn(() => 1),
    raceElapsed: vi.fn(() => null),
    getSnapshot: vi.fn(() => null),
    getResults: vi.fn(() => results),
    getRoster: vi.fn(() => []),
    getNickname: vi.fn(() => nickname),
  };
  const session = {
    client: { core },
    join: vi.fn(),
  };
  return session as unknown as TPlayerSession;
};

// ── 고정 데이터 ───────────────────────────────────────────────────

const WINNER = "펭수";
const RUNNER_UP = "뽀로로";
const LAST = "루피";

const RESULTS: TRaceResult[] = [
  { playerId: "p1", nickname: WINNER, distance: 128, fallen: false, rank: 1 },
  { playerId: "p2", nickname: RUNNER_UP, distance: 96, fallen: false, rank: 2 },
  { playerId: "p3", nickname: LAST, distance: 42, fallen: true, rank: 3 },
];

const FALLEN_MARKERS = ["꽈당", "넘어", "💥", "🤕", "😵"];

// ── DOM 헬퍼 (구조 가정 없이 텍스트/포함관계만 사용) ──────────────

const bodyText = (): string => document.body.textContent ?? "";

/** 해당 텍스트를 담은 가장 깊은 요소(자기 안에 같은 텍스트를 담은 자식이 없는 요소). */
const leafWith = (text: string): HTMLElement => {
  const all = [...document.body.querySelectorAll<HTMLElement>("*")].filter((el) =>
    el.textContent?.includes(text),
  );
  const leaves = all.filter((el) => !all.some((other) => other !== el && el.contains(other)));
  const found = leaves[0];
  expect(found, `"${text}" 텍스트를 화면에서 찾지 못했다`).toBeTruthy();
  return found;
};

/** a와 b를 동시에 담는 가장 가까운 조상 = 한 참가자의 "행". */
const rowWith = (a: string, b: string): HTMLElement => {
  let node: HTMLElement | null = leafWith(a);
  while (node && !(node.textContent?.includes(a) && node.textContent?.includes(b))) {
    node = node.parentElement;
  }
  expect(node, `"${a}"와 "${b}"를 함께 담은 행을 찾지 못했다`).toBeTruthy();
  return node as HTMLElement;
};

/** 문서 순서상 등장 위치. 없으면 실패. */
const positionOf = (text: string): number => {
  const index = bodyText().indexOf(text);
  expect(index, `"${text}"가 화면에 없다`).toBeGreaterThanOrEqual(0);
  return index;
};

const containsAny = (text: string, needles: string[]): boolean =>
  needles.some((needle) => text.includes(needle));

// ── 스토어 초기화 ────────────────────────────────────────────────

beforeEach(() => {
  useHostStore.setState({
    status: "ready",
    roomHandle: null,
    roomId: "ABCD",
    phase: "result",
    roster: [],
    results: null,
    errorMessage: null,
  });
  usePlayerStore.setState({
    screen: "game",
    status: "idle",
    nickname: null,
    rejectReason: null,
    roster: [],
    results: null,
    muted: false,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ── 호스트 순위 화면 (FR-015 · FR-016 · FR-017) ───────────────────

describe("HostResultContainer — 호스트 순위 발표", () => {
  it("results 3명을 rank 순서대로 렌더한다 (FR-015)", () => {
    const { handle } = createFakeRoom();
    useHostStore.setState({ results: RESULTS });

    render(<HostResultContainer room={handle} />);

    const first = positionOf(WINNER);
    const second = positionOf(RUNNER_UP);
    const third = positionOf(LAST);

    expect(first).toBeLessThan(second);
    expect(second).toBeLessThan(third);
  });

  it("results가 rank 오름차순이 아니어도 rank 기준으로 정렬해 렌더한다 (FR-015)", () => {
    const { handle } = createFakeRoom();
    useHostStore.setState({ results: [RESULTS[2], RESULTS[0], RESULTS[1]] });

    render(<HostResultContainer room={handle} />);

    expect(positionOf(WINNER)).toBeLessThan(positionOf(RUNNER_UP));
    expect(positionOf(RUNNER_UP)).toBeLessThan(positionOf(LAST));
  });

  it("1등 항목은 강조 표식으로 구별된다 (FR-015)", () => {
    const { handle } = createFakeRoom();
    useHostStore.setState({ results: RESULTS });

    render(<HostResultContainer room={handle} />);

    const winnerRow = rowWith(WINNER, "128");
    const byTestId = screen.queryByTestId("rank-1");
    const marked =
      (byTestId !== null && byTestId.textContent?.includes(WINNER) === true) ||
      containsAny(winnerRow.textContent ?? "", ["👑", "🥇", "1등", "1위"]) ||
      /(^|\D)1(\D|$)/.test(winnerRow.textContent ?? "");

    expect(marked, "1등 항목에 등수/왕관 등 구별 가능한 표식이 없다").toBe(true);
  });

  it("fallen:true 참가자에 넘어짐 표기를 노출한다 (FR-016)", () => {
    const { handle } = createFakeRoom();
    useHostStore.setState({ results: RESULTS });

    render(<HostResultContainer room={handle} />);

    const fallenRow = rowWith(LAST, "42");
    expect(
      containsAny(fallenRow.textContent ?? "", FALLEN_MARKERS),
      "넘어진 참가자 행에 넘어짐 표기(꽈당 등)가 없다",
    ).toBe(true);

    const winnerRow = rowWith(WINNER, "128");
    expect(
      containsAny(winnerRow.textContent ?? "", ["꽈당"]),
      "넘어지지 않은 참가자 행에 넘어짐 표기가 잘못 붙었다",
    ).toBe(false);
  });

  it("각 행에 최종 거리를 표시한다 (FR-015)", () => {
    const { handle } = createFakeRoom();
    useHostStore.setState({ results: RESULTS });

    render(<HostResultContainer room={handle} />);

    expect(rowWith(WINNER, "128").textContent).toContain("128");
    expect(rowWith(RUNNER_UP, "96").textContent).toContain("96");
    expect(rowWith(LAST, "42").textContent).toContain("42");
  });

  it("다시 하기 버튼을 누르면 room.core.returnLobby가 1회 호출된다 (FR-017)", async () => {
    const user = userEvent.setup();
    const { handle, core } = createFakeRoom();
    useHostStore.setState({ results: RESULTS });

    render(<HostResultContainer room={handle} />);

    await user.click(screen.getByRole("button", { name: /다시/ }));

    expect(core.returnLobby).toHaveBeenCalledTimes(1);
  });
});

// ── 개인 결과 화면 (FR-015 · FR-024 화면 측 대응) ─────────────────

describe("PersonalResultContainer — 개인 기록·등수", () => {
  it("내 등수와 내 거리를 강조 표시한다 (FR-015)", () => {
    usePlayerStore.setState({
      screen: "game",
      status: "result",
      nickname: RUNNER_UP,
      results: RESULTS,
    });
    const session = createFakeSession(RESULTS, RUNNER_UP);

    render(<PersonalResultContainer session={session} />);

    const text = bodyText();
    const rankShown =
      /2\s*(등|위)/.test(text) ||
      (screen.queryByTestId("my-rank")?.textContent?.includes("2") ?? false);

    expect(rankShown, "내 등수(2)가 화면에 표시되지 않았다").toBe(true);
    expect(text, "내 최종 거리(96)가 화면에 표시되지 않았다").toContain("96");
  });

  it("status=finished이고 results가 없으면 대기 안내를 노출한다 (FR-015)", () => {
    usePlayerStore.setState({
      screen: "game",
      status: "finished",
      nickname: RUNNER_UP,
      results: null,
    });
    const session = createFakeSession(null, RUNNER_UP);

    render(<PersonalResultContainer session={session} />);

    expect(screen.getByText(/대기/)).toBeInTheDocument();
    expect(bodyText()).not.toMatch(/\d\s*(등|위)/);
  });

  it("내 항목이 fallen:true면 넘어짐 문구를 표시한다 (FR-016)", () => {
    usePlayerStore.setState({
      screen: "game",
      status: "result",
      nickname: LAST,
      results: RESULTS,
    });
    const session = createFakeSession(RESULTS, LAST);

    render(<PersonalResultContainer session={session} />);

    expect(
      containsAny(bodyText(), FALLEN_MARKERS),
      "넘어진 내 기록에 넘어짐 문구가 없다",
    ).toBe(true);
  });
});

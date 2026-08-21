// US1(방 만들기와 참가) UI 컨테이너 계약 테스트 — 구현 전 작성(실패 상태로 시작).
//
// 근거 매핑:
// - FR-002 · US1-AS1 QR/URL 진입 후 닉네임 입력 화면 → describe("JoinContainer — 닉네임 입력")
// - FR-003 빈 닉네임 거부 / Edge "빈 값(공백만 포함)은 거부, 최대 길이 10자"
//                                             → 빈 값·공백·길이 초과 케이스
// - FR-026 저장된 신원(playerId·nickname) 승계 → 닉네임 프리필 케이스
// - FR-004 · US1-AS3 정원(MAX_PLAYERS) 초과 거부 안내
//   FR-020 레이스/결과 중 입장 차단 안내       → describe("JoinContainer — 거부·실패 안내")
// - FR-005 · US1-AS2 · US1-AS4 로비 참가자 목록(닉네임·연결 상태) 실시간
//                                             → describe("LobbyContainer — 참가자 목록")
// - FR-006 참가자 2명 이상일 때 시작 가능      → describe("LobbyContainer — 시작 버튼")
// - FR-001 방 코드 표시(QR SVG 자체는 검증 대상 아님)
//                                             → describe("LobbyContainer — 방 코드")
//
// 대상은 US1이 소유하는 컨테이너 두 개의 공개 props 계약뿐이다. 내부 서브컴포넌트는
// import하지 않고 화면 텍스트·role로만 검증한다. F 소유 모듈(P2P·오디오)은 목킹하고
// zustand 스토어는 실제 구현을 쓰되 테스트마다 초기화한다.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MAX_PLAYERS, NICKNAME_MAX_LENGTH } from "@/src/game/balance";
import type { THostRoomHandle } from "@/src/p2p/host-room";
import type { TRosterEntry } from "@/src/p2p/protocol";
import { useHostStore } from "@/src/stores/host-store";
import { usePlayerStore } from "@/src/stores/player-store";
import HostLobbyContainer from "@/src/components/host/LobbyContainer";
import PlayJoinContainer from "@/src/components/play/JoinContainer";

// FR-006 "2명 이상" — balance.ts에 대응 상수가 없어 스펙에서 직접 가져온 하한값.
const MIN_PLAYERS_TO_START = 2;

const ROOM_CODE = "abc234";
const ROOM_ID = `mgf-${ROOM_CODE}`;

// ── F 소유 모듈 목킹 ────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  identity: { playerId: "player-1", nickname: null as string | null },
}));

vi.mock("@/src/p2p/player-client", () => ({
  loadIdentity: () => mocks.identity,
  saveNickname: vi.fn(),
  createPlayerClient: vi.fn(),
  createPlayerCore: vi.fn(),
  nextReconnectDelay: vi.fn(() => 1_000),
}));

vi.mock("@/src/audio/sound", () => ({
  unlockAudio: vi.fn(async () => true),
  isAudioUnlocked: vi.fn(() => true),
  playSfx: vi.fn(),
  vibrate: vi.fn(() => true),
  startBgm: vi.fn(),
  stopBgm: vi.fn(),
}));

vi.mock("@/src/p2p/host-room", () => ({
  createHostRoom: vi.fn(),
  createHostRoomCore: vi.fn(),
  generateRoomId: vi.fn(() => ROOM_ID),
}));

// ── 헬퍼 ───────────────────────────────────────────────────────────

const entry = (nickname: string, connected = true): TRosterEntry => ({
  playerId: `p-${nickname}`,
  nickname,
  connected,
});

// room prop은 가짜 핸들. 코어 조회는 host-store를 그대로 되돌려주므로
// 컨테이너가 스토어를 읽든 핸들을 읽든 같은 roster를 본다.
const createFakeRoom = () => {
  const startRace = vi.fn();
  const returnLobby = vi.fn();
  const handle = {
    getRoomId: () => useHostStore.getState().roomId ?? ROOM_ID,
    core: {
      startRace,
      returnLobby,
      join: vi.fn(),
      markDisconnected: vi.fn(),
      handleMessage: vi.fn(),
      tick: vi.fn(),
      getPhase: () => useHostStore.getState().phase,
      getRoster: () => useHostStore.getState().roster,
      getResults: () => useHostStore.getState().results,
      getSnapshotFor: vi.fn(),
    },
    destroy: vi.fn(),
  } as unknown as THostRoomHandle;
  return { handle, startRace };
};

const renderJoin = (
  overrides: Partial<{
    roomId: string;
    rejectReason: string | null;
    connectFailed: boolean;
    onJoin: (nickname: string) => void;
  }> = {},
) => {
  const onJoin = vi.fn();
  const props = {
    roomId: ROOM_ID,
    rejectReason: null,
    connectFailed: false,
    onJoin,
    ...overrides,
  };
  render(<PlayJoinContainer {...props} />);
  return { onJoin: props.onJoin as ReturnType<typeof vi.fn> };
};

const renderLobby = (roster: TRosterEntry[], roomId: string | null = ROOM_ID) => {
  useHostStore.setState({ status: "ready", roomId, phase: "lobby", roster, results: null });
  const { handle, startRace } = createFakeRoom();
  useHostStore.setState({ roomHandle: handle });
  render(<HostLobbyContainer room={handle} />);
  return { startRace };
};

const nicknameInput = () => screen.getByRole("textbox");
const joinButton = () => screen.getByRole("button", { name: /입장/ });
const startButton = () => screen.getByRole("button", { name: /시작/ });

// 검증 안내는 새로 나타나는 텍스트로 노출한다(가능하면 role="alert"/"status").
// 라벨·플레이스홀더가 같은 낱말을 이미 담고 있어도 통과하지 않도록 증가분으로 본다.
const GUIDANCE_RE = /입력|비어|공백|필요|닉네임을/;

const guidanceNodes = (): HTMLElement[] =>
  [
    ...screen.queryAllByRole("alert"),
    ...screen.queryAllByRole("status"),
    ...screen.queryAllByText(GUIDANCE_RE),
  ].filter((el) => (el.textContent ?? "").trim().length > 0);

beforeEach(() => {
  mocks.identity = { playerId: "player-1", nickname: null };
  usePlayerStore.setState({
    screen: "nickname",
    status: "idle",
    nickname: null,
    rejectReason: null,
    roster: [],
    results: null,
    muted: false,
  });
  useHostStore.setState({
    status: "opening",
    roomHandle: null,
    roomId: null,
    phase: "lobby",
    roster: [],
    results: null,
    errorMessage: null,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ── JoinContainer ──────────────────────────────────────────────────

describe("JoinContainer — 닉네임 입력 (FR-002·FR-003)", () => {
  it("닉네임 입력창과 입장 버튼을 렌더한다", () => {
    renderJoin();

    expect(nicknameInput()).toBeInTheDocument();
    expect(joinButton()).toBeInTheDocument();
  });

  it("빈 값으로 입장하면 onJoin을 호출하지 않고 안내를 노출한다", async () => {
    const user = userEvent.setup();
    const { onJoin } = renderJoin();

    const before = guidanceNodes().length;
    await user.click(joinButton());

    expect(onJoin).not.toHaveBeenCalled();
    expect(guidanceNodes().length).toBeGreaterThan(before);
  });

  it("공백만 입력하고 입장하면 onJoin을 호출하지 않고 안내를 노출한다", async () => {
    const user = userEvent.setup();
    const { onJoin } = renderJoin();

    const before = guidanceNodes().length;
    await user.type(nicknameInput(), "   ");
    await user.click(joinButton());

    expect(onJoin).not.toHaveBeenCalled();
    expect(guidanceNodes().length).toBeGreaterThan(before);
  });

  it(`닉네임이 ${NICKNAME_MAX_LENGTH}자를 넘으면 잘리거나 거부되어 초과 길이가 onJoin으로 넘어가지 않는다`, async () => {
    const user = userEvent.setup();
    const { onJoin } = renderJoin();
    const tooLong = "가".repeat(NICKNAME_MAX_LENGTH + 5);

    await user.type(nicknameInput(), tooLong);
    await user.click(joinButton());

    expect(onJoin).not.toHaveBeenCalledWith(tooLong);
    for (const [nickname] of onJoin.mock.calls as [string][]) {
      expect(nickname.length).toBeLessThanOrEqual(NICKNAME_MAX_LENGTH);
    }
  });

  it("유효한 닉네임으로 입장하면 onJoin이 그 닉네임으로 한 번 호출된다", async () => {
    const user = userEvent.setup();
    const { onJoin } = renderJoin();

    await user.type(nicknameInput(), "지니");
    await user.click(joinButton());

    expect(onJoin).toHaveBeenCalledTimes(1);
    expect(onJoin).toHaveBeenCalledWith("지니");
  });

  it("저장된 신원의 닉네임을 입력창에 프리필한다 (FR-026)", () => {
    mocks.identity = { playerId: "player-1", nickname: "펭수" };

    renderJoin();

    expect(nicknameInput()).toHaveValue("펭수");
  });
});

describe("JoinContainer — 거부·실패 안내 (FR-004·FR-020)", () => {
  it("rejectReason이 room-full이면 정원 초과 안내를 노출한다", () => {
    renderJoin({ rejectReason: "room-full" });

    expect(screen.queryAllByText(/정원/).length).toBeGreaterThan(0);
  });

  it("rejectReason이 race-in-progress이면 진행 중 안내를 노출한다", () => {
    renderJoin({ rejectReason: "race-in-progress" });

    expect(screen.queryAllByText(/진행/).length).toBeGreaterThan(0);
  });

  it("connectFailed이면 다시 시도 버튼을 노출한다", () => {
    renderJoin({ connectFailed: true });

    expect(screen.getByRole("button", { name: /다시/ })).toBeInTheDocument();
  });
});

// ── LobbyContainer ─────────────────────────────────────────────────

describe("LobbyContainer — 참가자 목록 (FR-005)", () => {
  it("roster의 닉네임을 모두 렌더하고 연결이 끊긴 참가자를 끊김으로 표시한다", () => {
    renderLobby([entry("지니"), entry("펭수", false)]);

    expect(screen.queryAllByText(/지니/).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/펭수/).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/끊김|연결\s*끊|오프라인/).length).toBeGreaterThan(0);
  });

  it(`정원(${MAX_PLAYERS}명)이 가득 차도 전원을 목록에 렌더한다`, () => {
    const full = Array.from({ length: MAX_PLAYERS }, (_, i) => entry(`참가자${i + 1}`));

    renderLobby(full);

    for (const player of full) {
      expect(screen.queryAllByText(new RegExp(player.nickname)).length).toBeGreaterThan(0);
    }
  });
});

describe("LobbyContainer — 시작 버튼 (FR-006)", () => {
  it(`참가자가 ${MIN_PLAYERS_TO_START}명 미만이면 시작 버튼이 비활성이다`, () => {
    renderLobby([entry("지니")]);

    expect(startButton()).toBeDisabled();
  });

  it(`참가자가 ${MIN_PLAYERS_TO_START}명 이상이면 시작 버튼이 활성이고 클릭 시 startRace를 한 번 호출한다`, async () => {
    const user = userEvent.setup();
    const { startRace } = renderLobby([entry("지니"), entry("펭수")]);

    expect(startButton()).toBeEnabled();
    await user.click(startButton());

    expect(startRace).toHaveBeenCalledTimes(1);
  });
});

describe("LobbyContainer — 방 코드 (FR-001)", () => {
  it("host-store의 roomId를 방 코드 텍스트로 노출한다", () => {
    renderLobby([], ROOM_ID);

    expect(screen.queryAllByText(new RegExp(ROOM_CODE, "i")).length).toBeGreaterThan(0);
  });
});

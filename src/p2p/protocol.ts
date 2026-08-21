// 호스트 ↔ 플레이어 P2P 메시지 프로토콜 v1.
// specs/001-penguin-party/contracts/p2p-protocol.md와 1:1 유지(불일치 = 버그).

export const PROTOCOL_VERSION = 1 as const;

export type TSide = "L" | "R";
export type TPhase = "lobby" | "countdown" | "race" | "result";
export type TJoinRejectReason = "room-full" | "race-in-progress" | "invalid-nickname";

export interface TRosterEntry {
  playerId: string;
  nickname: string;
  connected: boolean;
}

export interface TRaceResult {
  playerId: string;
  nickname: string;
  distance: number;
  fallen: boolean;
  rank: number;
}

export interface TRoomSnapshot {
  phase: TPhase;
  raceId: number | null;
  remainingMs: number | null;
  roster: TRosterEntry[];
  ownRecord: { distance: number; fallen: boolean; finishedAt: number } | null;
  results: TRaceResult[] | null;
}

interface TBaseMsg {
  v: typeof PROTOCOL_VERSION;
}

// ── 플레이어 → 호스트 ──────────────────────────────────────────────

export interface TJoinMsg extends TBaseMsg {
  type: "join";
  playerId: string;
  nickname?: string; // 재접속이면 생략 가능 — 호스트가 기존 값 복원
}

export interface THeartbeatMsg extends TBaseMsg {
  type: "heartbeat";
  t: number;
}

export interface TStateMsg extends TBaseMsg {
  type: "state";
  raceId: number;
  seq: number;
  distance: number;
  tilt: number;
  fallen: boolean;
  distanceReachedAt: number | null;
}

export interface TFallMsg extends TBaseMsg {
  type: "fall";
  raceId: number;
  distance: number;
  distanceReachedAt: number | null;
  finishedAt: number;
}

export interface TFinishMsg extends TBaseMsg {
  type: "finish";
  raceId: number;
  distance: number;
  distanceReachedAt: number | null;
  finishedAt: number;
}

export type TPlayerMsg = TJoinMsg | THeartbeatMsg | TStateMsg | TFallMsg | TFinishMsg;

// ── 호스트 → 플레이어 ──────────────────────────────────────────────

export interface TJoinedMsg extends TBaseMsg {
  type: "joined";
  playerId: string;
  nickname: string; // 중복 접미사 반영된 확정값
  resumed: boolean;
  snapshot: TRoomSnapshot;
}

export interface TJoinRejectedMsg extends TBaseMsg {
  type: "join-rejected";
  reason: TJoinRejectReason;
}

export interface TRosterMsg extends TBaseMsg {
  type: "roster";
  players: TRosterEntry[];
}

export interface TRaceStartMsg extends TBaseMsg {
  type: "race-start";
  raceId: number;
  countdownMs: number;
  durationMs: number;
}

export interface TRaceEndMsg extends TBaseMsg {
  type: "race-end";
  raceId: number;
  results: TRaceResult[];
}

export interface TReturnLobbyMsg extends TBaseMsg {
  type: "return-lobby";
}

export interface TRoomClosedMsg extends TBaseMsg {
  type: "room-closed";
}

export interface THeartbeatAckMsg extends TBaseMsg {
  type: "heartbeat-ack";
  t: number; // 에코 — 플레이어가 RTT 계산
  hostT: number; // 호스트 시각 — 계측 모드 시계 오프셋 추정용
}

export type THostMsg =
  | TJoinedMsg
  | TJoinRejectedMsg
  | TRosterMsg
  | TRaceStartMsg
  | TRaceEndMsg
  | TReturnLobbyMsg
  | TRoomClosedMsg
  | THeartbeatAckMsg;

export type TAnyMsg = TPlayerMsg | THostMsg;

// ── 수신 유효성 ────────────────────────────────────────────────────

const KNOWN_TYPES = new Set<TAnyMsg["type"]>([
  "join",
  "heartbeat",
  "state",
  "fall",
  "finish",
  "joined",
  "join-rejected",
  "roster",
  "race-start",
  "race-end",
  "return-lobby",
  "room-closed",
  "heartbeat-ack",
]);

// 알 수 없는 type·다른 버전은 무시(전방 호환). null 반환 = 폐기.
export const parseMessage = (raw: unknown): TAnyMsg | null => {
  if (typeof raw !== "object" || raw === null) return null;
  const msg = raw as Partial<TAnyMsg>;
  if (msg.v !== PROTOCOL_VERSION || typeof msg.type !== "string") return null;
  if (!KNOWN_TYPES.has(msg.type as TAnyMsg["type"])) return null;
  return msg as TAnyMsg;
};

// 상태 스냅샷 폐기 규칙: 현재 raceId와 다르거나 저장된 최대 seq 이하이면 무시.
export const isStaleState = (
  msg: Pick<TStateMsg, "raceId" | "seq">,
  currentRaceId: number,
  maxSeenSeq: number,
): boolean => msg.raceId !== currentRaceId || msg.seq <= maxSeenSeq;

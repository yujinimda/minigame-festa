// 호스트 룸 — 방 상태의 단일 진실.
// 코어(createHostRoomCore)는 PeerJS 무의존 순수 로직으로 테스트 대상이고,
// createHostRoom이 PeerJS 배선(2채널·하트비트 감시)을 얹는다.
// 계약 근거: specs/001-penguin-party/contracts/p2p-protocol.md

import Peer, { type DataConnection } from "peerjs";
import {
  COUNTDOWN_MS,
  HEARTBEAT_TIMEOUT_MS,
  MAX_PLAYERS,
  NICKNAME_MAX_LENGTH,
  RACE_DURATION_MS,
} from "@/src/game/balance";
import {
  PROTOCOL_VERSION,
  isStaleState,
  parseMessage,
  type TFallMsg,
  type TFinishMsg,
  type THostMsg,
  type TPhase,
  type TPlayerMsg,
  type TRaceResult,
  type TRoomSnapshot,
  type TRosterEntry,
  type TStateMsg,
} from "@/src/p2p/protocol";

interface TPlayerSlot {
  playerId: string;
  nickname: string;
  connected: boolean;
  joinOrder: number;
  lastSeenAt: number;
  // 레이스 상태 (레이스 중에만 의미)
  seq: number;
  distance: number;
  tilt: number;
  fallen: boolean;
  distanceReachedAt: number | null;
  finalized: boolean;
  finishedAt: number | null;
}

export interface THostRoomCoreOptions {
  now: () => number;
  send: (playerId: string, msg: THostMsg) => void;
  broadcast: (msg: THostMsg) => void;
}

export interface THostRoomCore {
  join(playerId: string, nickname: string | undefined): void;
  markDisconnected(playerId: string): void;
  handleMessage(playerId: string, msg: TPlayerMsg): void;
  startRace(): void;
  tick(): void;
  returnLobby(): void;
  getPhase(): TPhase;
  getRoster(): TRosterEntry[];
  getResults(): TRaceResult[] | null;
  getSnapshotFor(playerId: string): TRoomSnapshot;
}

const cleanNickname = (raw: string | undefined): string | null => {
  const trimmed = raw?.trim() ?? "";
  if (trimmed.length === 0 || trimmed.length > NICKNAME_MAX_LENGTH) return null;
  return trimmed;
};

export const createHostRoomCore = (
  options: THostRoomCoreOptions,
): THostRoomCore => {
  const { now, send, broadcast } = options;
  const players = new Map<string, TPlayerSlot>();
  let phase: TPhase = "lobby";
  let raceId = 1;
  let joinCounter = 0;
  let raceStartedAt: number | null = null; // startRace 호출 시각(카운트다운 시작)
  let results: TRaceResult[] | null = null;

  const roster = (): TRosterEntry[] =>
    [...players.values()]
      .sort((a, b) => a.joinOrder - b.joinOrder)
      .map(({ playerId, nickname, connected }) => ({ playerId, nickname, connected }));

  const remainingMs = (): number | null => {
    if (raceStartedAt === null) return null;
    const elapsed = now() - raceStartedAt;
    if (phase === "countdown") return Math.max(0, COUNTDOWN_MS - elapsed);
    if (phase === "race") {
      return Math.max(0, COUNTDOWN_MS + RACE_DURATION_MS - elapsed);
    }
    return null;
  };

  const snapshotFor = (playerId: string): TRoomSnapshot => {
    const slot = players.get(playerId);
    return {
      phase,
      raceId: phase === "lobby" ? null : raceId,
      remainingMs: remainingMs(),
      roster: roster(),
      ownRecord:
        slot && slot.finalized
          ? {
              distance: slot.distance,
              fallen: slot.fallen,
              finishedAt: slot.finishedAt ?? 0,
            }
          : null,
      results,
    };
  };

  const uniqueNickname = (base: string): string => {
    const taken = new Set([...players.values()].map((p) => p.nickname));
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base} (${n})`)) n += 1;
    return `${base} (${n})`;
  };

  const finalizeSlot = (slot: TPlayerSlot, finishedAt: number): void => {
    if (slot.finalized) return;
    slot.finalized = true;
    slot.finishedAt = finishedAt;
  };

  const aggregateResults = (): TRaceResult[] => {
    const ranked = [...players.values()].sort((a, b) => {
      if (b.distance !== a.distance) return b.distance - a.distance;
      const aReached = a.distanceReachedAt ?? Number.POSITIVE_INFINITY;
      const bReached = b.distanceReachedAt ?? Number.POSITIVE_INFINITY;
      if (aReached !== bReached) return aReached - bReached;
      return a.joinOrder - b.joinOrder; // 3단계 최종 유일화(FR-021)
    });
    return ranked.map((slot, index) => ({
      playerId: slot.playerId,
      nickname: slot.nickname,
      distance: slot.distance,
      fallen: slot.fallen,
      rank: index + 1,
    }));
  };

  const endRace = (): void => {
    const deadline = (raceStartedAt ?? now()) + COUNTDOWN_MS + RACE_DURATION_MS;
    for (const slot of players.values()) finalizeSlot(slot, deadline);
    results = aggregateResults();
    phase = "result";
    broadcast({ v: PROTOCOL_VERSION, type: "race-end", raceId, results });
  };

  const handleState = (slot: TPlayerSlot, msg: TStateMsg): void => {
    if (phase !== "race" && phase !== "countdown") return;
    if (slot.finalized) return;
    if (isStaleState(msg, raceId, slot.seq)) return;
    slot.seq = msg.seq;
    slot.distance = msg.distance;
    slot.tilt = msg.tilt;
    slot.fallen = msg.fallen;
    slot.distanceReachedAt = msg.distanceReachedAt;
  };

  const handleRecordMsg = (slot: TPlayerSlot, msg: TFallMsg | TFinishMsg): void => {
    if (msg.raceId !== raceId || slot.finalized) return;
    slot.distance = msg.distance;
    slot.distanceReachedAt = msg.distanceReachedAt;
    slot.fallen = msg.type === "fall";
    finalizeSlot(slot, msg.finishedAt);
  };

  const markDisconnected = (playerId: string): void => {
    const slot = players.get(playerId);
    if (!slot || !slot.connected) return;
    slot.connected = false;
    // FR-019: 레이스 중 끊김 → 마지막 수신 상태로 확정, fallen 유지(false면 false)
    if (phase === "race" || phase === "countdown") {
      finalizeSlot(slot, now() - (raceStartedAt ?? now()));
    }
    broadcast({ v: PROTOCOL_VERSION, type: "roster", players: roster() });
  };

  return {
    join(playerId, rawNickname) {
      const existing = players.get(playerId);
      if (existing) {
        // 재접속(FR-026): phase 무관 허용, 정원 미산입, 기존 값 승계
        existing.connected = true;
        existing.lastSeenAt = now();
        send(playerId, {
          v: PROTOCOL_VERSION,
          type: "joined",
          playerId,
          nickname: existing.nickname,
          resumed: true,
          snapshot: snapshotFor(playerId),
        });
        broadcast({ v: PROTOCOL_VERSION, type: "roster", players: roster() });
        return;
      }

      if (phase !== "lobby") {
        send(playerId, { v: PROTOCOL_VERSION, type: "join-rejected", reason: "race-in-progress" });
        return;
      }
      if (players.size >= MAX_PLAYERS) {
        send(playerId, { v: PROTOCOL_VERSION, type: "join-rejected", reason: "room-full" });
        return;
      }
      const base = cleanNickname(rawNickname);
      if (base === null) {
        send(playerId, { v: PROTOCOL_VERSION, type: "join-rejected", reason: "invalid-nickname" });
        return;
      }

      const nickname = uniqueNickname(base);
      joinCounter += 1;
      players.set(playerId, {
        playerId,
        nickname,
        connected: true,
        joinOrder: joinCounter,
        lastSeenAt: now(),
        seq: 0,
        distance: 0,
        tilt: 0,
        fallen: false,
        distanceReachedAt: null,
        finalized: false,
        finishedAt: null,
      });
      send(playerId, {
        v: PROTOCOL_VERSION,
        type: "joined",
        playerId,
        nickname,
        resumed: false,
        snapshot: snapshotFor(playerId),
      });
      broadcast({ v: PROTOCOL_VERSION, type: "roster", players: roster() });
    },

    markDisconnected,

    handleMessage(playerId, msg) {
      const slot = players.get(playerId);
      if (!slot) return;
      slot.lastSeenAt = now();
      switch (msg.type) {
        case "heartbeat":
          send(playerId, { v: PROTOCOL_VERSION, type: "heartbeat-ack", t: msg.t, hostT: now() });
          return;
        case "state":
          handleState(slot, msg);
          return;
        case "fall":
        case "finish":
          handleRecordMsg(slot, msg);
          return;
        case "join":
          return; // join() 진입점으로만 처리
      }
    },

    startRace() {
      if (phase !== "lobby") return;
      phase = "countdown";
      raceStartedAt = now();
      results = null;
      broadcast({
        v: PROTOCOL_VERSION,
        type: "race-start",
        raceId,
        countdownMs: COUNTDOWN_MS,
        durationMs: RACE_DURATION_MS,
      });
    },

    tick() {
      if (raceStartedAt === null) return;
      const elapsed = now() - raceStartedAt;
      if (phase === "countdown" && elapsed >= COUNTDOWN_MS) phase = "race";
      if (phase === "race") {
        const everyoneDone = [...players.values()].every((p) => p.finalized);
        if (elapsed >= COUNTDOWN_MS + RACE_DURATION_MS || (players.size > 0 && everyoneDone)) {
          endRace();
        }
      }
      // 하트비트 타임아웃 감시 (close 이벤트 단독 의존 금지)
      for (const slot of players.values()) {
        if (slot.connected && now() - slot.lastSeenAt > HEARTBEAT_TIMEOUT_MS) {
          markDisconnected(slot.playerId);
        }
      }
    },

    returnLobby() {
      if (phase !== "result") return;
      phase = "lobby";
      raceId += 1;
      raceStartedAt = null;
      results = null;
      for (const slot of players.values()) {
        slot.seq = 0;
        slot.distance = 0;
        slot.tilt = 0;
        slot.fallen = false;
        slot.distanceReachedAt = null;
        slot.finalized = false;
        slot.finishedAt = null;
      }
      broadcast({ v: PROTOCOL_VERSION, type: "return-lobby" });
    },

    getPhase: () => phase,
    getRoster: roster,
    getResults: () => results,
    getSnapshotFor: snapshotFor,
  };
};

// ── PeerJS 배선 ────────────────────────────────────────────────────

const ROOM_ID_PREFIX = "mgf-";
const ROOM_CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export const generateRoomId = (): string =>
  ROOM_ID_PREFIX +
  Array.from({ length: 6 }, () =>
    ROOM_CODE_ALPHABET.charAt(Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)),
  ).join("");

export interface THostRoomHandle {
  getRoomId: () => string; // unavailable-id 재발급 가능 — onReady 수신값이 정본
  core: THostRoomCore;
  destroy: () => void;
}

export interface TCreateHostRoomOptions {
  onReady: (roomId: string) => void;
  onError: (error: Error) => void;
  onChange: () => void; // roster/phase/results 변동 알림 → 스토어 갱신
}

// 호스트 브라우저에서만 호출. ID 충돌(unavailable-id) 시 새 코드로 자동 재발급.
export const createHostRoom = (options: TCreateHostRoomOptions): THostRoomHandle => {
  const connections = new Map<string, DataConnection>(); // control 채널
  let destroyed = false;
  let peer: Peer | null = null;
  let roomId = generateRoomId();

  const startedAt = Date.now();
  const core = createHostRoomCore({
    now: () => Date.now() - startedAt,
    send: (playerId, msg) => {
      connections.get(playerId)?.send(msg);
    },
    broadcast: (msg) => {
      for (const conn of connections.values()) conn.send(msg);
      options.onChange();
    },
  });

  const bindConnection = (conn: DataConnection): void => {
    const playerId = String(conn.metadata?.playerId ?? "");
    if (!playerId) {
      conn.close();
      return;
    }
    conn.on("data", (raw) => {
      const msg = parseMessage(raw);
      if (!msg) return;
      if (msg.type === "join") {
        // 연결 세대: 같은 playerId의 새 control 연결이 오면 이전 연결을 닫고 교체
        if (conn.metadata?.channel !== "state") {
          const prev = connections.get(playerId);
          if (prev && prev !== conn) prev.close();
          connections.set(playerId, conn);
        }
        core.join(playerId, msg.nickname);
      } else if (msg.type !== "heartbeat-ack") {
        core.handleMessage(playerId, msg as TPlayerMsg);
      }
      options.onChange();
    });
    conn.on("close", () => {
      if (connections.get(playerId) === conn) {
        core.markDisconnected(playerId);
        connections.delete(playerId);
        options.onChange();
      }
    });
    conn.on("error", () => {
      if (connections.get(playerId) === conn) {
        core.markDisconnected(playerId);
        options.onChange();
      }
    });
  };

  const open = (): void => {
    if (destroyed) return;
    peer = new Peer(roomId);
    peer.on("open", () => options.onReady(roomId));
    peer.on("connection", bindConnection);
    peer.on("error", (err: Error & { type?: string }) => {
      if (err.type === "unavailable-id" && !destroyed) {
        roomId = generateRoomId();
        peer?.destroy();
        open();
        return;
      }
      options.onError(err);
    });
  };

  open();

  const ticker = setInterval(() => {
    core.tick();
    options.onChange();
  }, 100);

  return {
    getRoomId: () => roomId,
    core,
    destroy: () => {
      destroyed = true;
      clearInterval(ticker);
      const closing: THostMsg = { v: PROTOCOL_VERSION, type: "room-closed" };
      for (const conn of connections.values()) {
        conn.send(closing);
        conn.close();
      }
      peer?.destroy();
    },
  };
};

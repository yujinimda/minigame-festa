// 호스트 룸 — 방 상태의 단일 진실.
// 코어(createHostRoomCore)는 PeerJS 무의존 순수 로직으로 테스트 대상이고,
// createHostRoom이 PeerJS 배선(2채널·하트비트 감시)을 얹는다.
// 계약 근거: specs/001-penguin-party/contracts/p2p-protocol.md

import Peer, { type DataConnection } from "peerjs";
import {
  COUNTDOWN_MS,
  HEARTBEAT_TIMEOUT_MS,
  MAX_PLAYERS,
  MIN_PLAYERS,
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
  wallNow?: () => number; // heartbeat-ack.hostT용 벽시계(계약 — 시계 오프셋 추정). 기본 Date.now
}

export interface TRacePosition {
  playerId: string;
  nickname: string;
  distance: number;
  tilt: number;
  fallen: boolean;
  finalized: boolean;
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
  hasPlayer(playerId: string): boolean;
  countdownRemainingMs(): number | null;
  // Phaser 씬이 rAF에서 직접 폴링하는 경로 — React 리렌더 없이 위치 갱신(R6, 게이트8 B9)
  getRacePositions(): TRacePosition[];
  raceRemainingMs(): number | null;
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
  // hostT용 시계 — 배선(createHostRoom)이 Date.now를 주입해 벽시계가 된다(계약 §heartbeat-ack).
  // 미주입 시 now로 폴백(순수 테스트 환경)
  const wallNow = options.wallNow ?? now;
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

  // 계약: countdown/race 공통으로 "레이스 종료까지 전체 잔여(카운트다운 잔여 포함)".
  // 플레이어 재접속 역산과 의미가 일치해야 한다(게이트8 B5)
  const remainingMs = (): number | null => {
    if (raceStartedAt === null) return null;
    if (phase !== "countdown" && phase !== "race") return null;
    return Math.max(0, COUNTDOWN_MS + RACE_DURATION_MS - (now() - raceStartedAt));
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
    // finishedAt 기준 통일: 레이스(본게임) 시작 기준 경과 ms — 완주자는 풀타임
    for (const slot of players.values()) finalizeSlot(slot, RACE_DURATION_MS);
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
    // FR-019: 레이스 중 끊김 → 마지막 수신 상태로 확정, fallen 유지(false면 false).
    // finishedAt은 레이스(본게임) 시작 기준 경과로 통일
    if (phase === "race" || phase === "countdown") {
      const raceElapsed = now() - (raceStartedAt ?? now()) - COUNTDOWN_MS;
      finalizeSlot(slot, Math.min(Math.max(0, raceElapsed), RACE_DURATION_MS));
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
          send(playerId, { v: PROTOCOL_VERSION, type: "heartbeat-ack", t: msg.t, hostT: wallNow() });
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
      // FR-006 권위 판정 — 등록 인원 기준. connected 기준은 T009 계약(하트비트 없는
      // 시간 전진 시나리오)과 충돌해 되돌림 — 유령 방 방지는 UI 필터(LobbyContainer) 담당
      if (players.size < MIN_PLAYERS) return;
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
    hasPlayer: (playerId) => players.has(playerId),
    // 호스트 UI용 phase 상대 잔여 — raceRemainingMs(전체 잔여)를 카운트다운 표시에
    // 그대로 쓰면 32s가 나오는 오용 방지
    countdownRemainingMs: () =>
      phase === "countdown" && raceStartedAt !== null
        ? Math.max(0, COUNTDOWN_MS - (now() - raceStartedAt))
        : null,
    getRacePositions: () =>
      [...players.values()]
        .sort((a, b) => a.joinOrder - b.joinOrder)
        .map(({ playerId, nickname, distance, tilt, fallen, finalized }) => ({
          playerId,
          nickname,
          distance,
          tilt,
          fallen,
          finalized,
        })),
    raceRemainingMs: remainingMs,
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
  const pendingCloses = new Set<ReturnType<typeof setTimeout>>(); // 거부 conn 지연 close
  let destroyed = false;
  let peer: Peer | null = null;
  let roomId = generateRoomId();

  const startedAt = Date.now();
  const core = createHostRoomCore({
    now: () => Date.now() - startedAt,
    wallNow: Date.now,
    send: (playerId, msg) => {
      connections.get(playerId)?.send(msg);
    },
    broadcast: (msg) => {
      for (const conn of connections.values()) conn.send(msg);
      notifyIfChanged();
    },
  });

  // React 리렌더 게이트(게이트8 B9): phase/roster/results가 실제로 바뀐 때만 onChange.
  // 레이스 중 10Hz state 수신·100ms tick은 여기서 걸러지고, 위치는 Phaser가
  // core.getRacePositions()를 rAF에서 직접 폴링한다.
  let lastSignature = "";
  const notifyIfChanged = (): void => {
    const results = core.getResults();
    const signature = [
      core.getPhase(),
      core
        .getRoster()
        .map((r) => `${r.playerId}:${r.nickname}:${r.connected}`)
        .join(","),
      results ? results.map((r) => `${r.playerId}:${r.rank}`).join(",") : "-",
    ].join("|");
    if (signature !== lastSignature) {
      lastSignature = signature;
      options.onChange();
    }
  };

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
        // 연결 세대: 같은 playerId의 새 control 연결이 오면 교체 후 이전 연결을 닫는다.
        // 순서 중요 — peerjs의 close()는 동기 emit이라 set을 먼저 해야
        // prev의 close 핸들러 가드가 통과되지 않는다(게이트8 B1)
        if (conn.metadata?.channel !== "state") {
          const prev = connections.get(playerId);
          connections.set(playerId, conn);
          if (prev && prev !== conn) prev.close();
        }
        core.join(playerId, msg.nickname);
        // 거부된 참가자는 등록 해제 + 거부 메시지 flush 후 연결 정리
        if (!core.hasPlayer(playerId) && connections.get(playerId) === conn) {
          connections.delete(playerId);
          const timer = setTimeout(() => {
            pendingCloses.delete(timer);
            conn.close();
          }, 500);
          pendingCloses.add(timer);
        }
      } else if (msg.type !== "heartbeat-ack") {
        core.handleMessage(playerId, msg as TPlayerMsg);
      }
      notifyIfChanged();
    });
    conn.on("close", () => {
      if (connections.get(playerId) === conn) {
        core.markDisconnected(playerId);
        connections.delete(playerId);
        notifyIfChanged();
      }
    });
    conn.on("error", () => {
      if (connections.get(playerId) === conn) {
        core.markDisconnected(playerId);
        notifyIfChanged();
      }
    });
  };

  const open = (): void => {
    if (destroyed) return;
    peer = new Peer(roomId);
    peer.on("open", () => options.onReady(roomId));
    peer.on("connection", bindConnection);
    // 시그널링 단절 시 재연결 — 기존 DataConnection은 유지되지만
    // 재연결 없이는 신규 참가자가 영구히 못 들어온다(PeerJS Cloud 리스크, R1)
    peer.on("disconnected", () => {
      if (!destroyed) peer?.reconnect();
    });
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
    notifyIfChanged();
  }, 100);

  return {
    getRoomId: () => roomId,
    core,
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      clearInterval(ticker);
      for (const timer of pendingCloses) clearTimeout(timer);
      pendingCloses.clear();
      const closing: THostMsg = { v: PROTOCOL_VERSION, type: "room-closed" };
      for (const conn of connections.values()) conn.send(closing);
      // room-closed flush 여유 후 정리(거부 경로와 동일 기준). 어차피 플레이어는
      // 하트비트 타임아웃만으로도 동일 처리된다(계약 §연결 수명)
      const conns = [...connections.values()];
      const finalPeer = peer;
      setTimeout(() => {
        for (const conn of conns) conn.close();
        finalPeer?.destroy();
      }, 300);
    },
  };
};

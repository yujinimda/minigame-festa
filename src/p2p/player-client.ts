// 플레이어 클라이언트 — 접속·재접속·하트비트·레이스 수명주기(로컬 타이머, R4).
// 코어(createPlayerCore)는 PeerJS 무의존 순수 로직으로 테스트 대상이고,
// createPlayerClient가 PeerJS 배선(2채널·10Hz 송신·백오프)을 얹는다.

import Peer, { type DataConnection } from "peerjs";
import {
  BUFFERED_AMOUNT_LIMIT,
  CONNECT_TIMEOUT_MS,
  COUNTDOWN_MS,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  RACE_DURATION_MS,
  RECONNECT_BACKOFF_MS,
  ROOM_CLOSED_TIMEOUT_MS,
  STATE_SEND_HZ,
} from "@/src/game/balance";
import {
  PROTOCOL_VERSION,
  parseMessage,
  type THostMsg,
  type TPlayerMsg,
  type TRaceResult,
  type TRoomSnapshot,
  type TRosterEntry,
} from "@/src/p2p/protocol";

export type TPlayerStatus =
  | "idle"
  | "joined"
  | "countdown"
  | "racing"
  | "finished"
  | "result"
  | "reconnecting"
  | "closed";

// 백오프 수열: 1s → 2s → 4s → 10s, 이후 계속 10s
export const nextReconnectDelay = (attempt: number): number => {
  const index = Math.min(attempt, RECONNECT_BACKOFF_MS.length - 1);
  return RECONNECT_BACKOFF_MS[index];
};

export interface TPlayerCoreOptions {
  now: () => number;
  send: (msg: TPlayerMsg) => void;
}

export interface TPlayerCore {
  handleHostMsg(msg: THostMsg): void;
  tick(): void;
  reportFall(distance: number, distanceReachedAt: number | null): void;
  getStatus(): TPlayerStatus;
  getRaceId(): number | null;
  raceElapsed(): number | null; // 레이스(본게임) 시작 기준 경과 ms — countdown 중 음수
  getSnapshot(): TRoomSnapshot | null;
  getResults(): TRaceResult[] | null;
  getRoster(): TRosterEntry[];
  getNickname(): string | null;
}

export const createPlayerCore = (options: TPlayerCoreOptions): TPlayerCore => {
  const { now, send } = options;
  let status: TPlayerStatus = "idle";
  let raceId: number | null = null;
  let raceStartReceivedAt: number | null = null; // 수신 시점 기준 로컬 타이머(R4)
  let countdownMs = COUNTDOWN_MS;
  let durationMs = RACE_DURATION_MS;
  let lastHostSeenAt: number | null = null;
  let finishSent = false;
  let fallSent = false;
  let snapshot: TRoomSnapshot | null = null;
  let results: TRaceResult[] | null = null;
  let nickname: string | null = null;
  let lastDistance = 0;
  let lastDistanceReachedAt: number | null = null;

  const markHostSeen = (): void => {
    lastHostSeenAt = now();
    if (status === "reconnecting") status = "joined";
  };

  return {
    handleHostMsg(msg) {
      markHostSeen();
      switch (msg.type) {
        case "joined": {
          snapshot = msg.snapshot;
          nickname = msg.nickname;
          raceId = msg.snapshot.raceId;
          if (msg.snapshot.phase === "result") {
            results = msg.snapshot.results;
            status = "result";
          } else if (msg.snapshot.phase === "race" || msg.snapshot.phase === "countdown") {
            // 재접속 복원: 남은 시간 기준으로 로컬 타이머 재구성
            const remaining = msg.snapshot.remainingMs ?? 0;
            raceStartReceivedAt = now() - (COUNTDOWN_MS + durationMs - remaining);
            status = msg.snapshot.ownRecord ? "finished" : msg.snapshot.phase === "race" ? "racing" : "countdown";
          } else {
            status = "joined";
          }
          return;
        }
        case "roster":
          if (snapshot) snapshot = { ...snapshot, roster: msg.players };
          return;
        case "race-start":
          raceId = msg.raceId;
          countdownMs = msg.countdownMs;
          durationMs = msg.durationMs;
          raceStartReceivedAt = now();
          finishSent = false;
          fallSent = false;
          lastDistance = 0;
          lastDistanceReachedAt = null;
          status = "countdown";
          return;
        case "race-end":
          results = msg.results;
          status = "result";
          return;
        case "return-lobby":
          status = "joined";
          results = null;
          raceStartReceivedAt = null;
          return;
        case "room-closed":
          status = "closed";
          return;
        case "heartbeat-ack":
        case "join-rejected":
          return; // heartbeat-ack은 markHostSeen으로 충분, 거부는 UI 레이어가 처리
      }
    },

    tick() {
      // 레이스 수명주기: countdown → racing → (로컬 30s 만료) finish 1회 송신
      if (raceStartReceivedAt !== null && (status === "countdown" || status === "racing")) {
        const elapsed = now() - raceStartReceivedAt;
        if (status === "countdown" && elapsed >= countdownMs) status = "racing";
        if (status === "racing" && elapsed >= countdownMs + durationMs && !finishSent && raceId !== null) {
          finishSent = true;
          status = "finished";
          send({
            v: PROTOCOL_VERSION,
            type: "finish",
            raceId,
            distance: lastDistance,
            distanceReachedAt: lastDistanceReachedAt,
            finishedAt: elapsed - countdownMs,
          });
        }
      }
      // 호스트 생존 감시: ack 부재 6s → reconnecting, 20s → closed
      if (lastHostSeenAt !== null && status !== "closed" && status !== "idle") {
        const silent = now() - lastHostSeenAt;
        if (silent >= ROOM_CLOSED_TIMEOUT_MS) status = "closed";
        else if (silent >= HEARTBEAT_TIMEOUT_MS && status !== "reconnecting") status = "reconnecting";
      }
    },

    reportFall(distance, distanceReachedAt) {
      if (fallSent || finishSent || raceId === null || raceStartReceivedAt === null) return;
      fallSent = true;
      status = "finished";
      lastDistance = distance;
      lastDistanceReachedAt = distanceReachedAt;
      send({
        v: PROTOCOL_VERSION,
        type: "fall",
        raceId,
        distance,
        distanceReachedAt,
        finishedAt: now() - raceStartReceivedAt - countdownMs,
      });
    },

    getStatus: () => status,
    getRaceId: () => raceId,
    raceElapsed: () =>
      raceStartReceivedAt === null ? null : now() - raceStartReceivedAt - countdownMs,
    getSnapshot: () => snapshot,
    getResults: () => results,
    getRoster: () => snapshot?.roster ?? [],
    getNickname: () => nickname,
  };
};

// 코어가 state 송신 페이로드로 쓸 마지막 값 갱신용 훅 — wrapper에서 사용
export interface TStatePayload {
  distance: number;
  tilt: number;
  fallen: boolean;
  distanceReachedAt: number | null;
}

// ── localStorage 신원 (FR-026) ─────────────────────────────────────

const STORAGE_KEY = "mgf-identity";

export interface TPlayerIdentity {
  playerId: string;
  nickname: string | null;
}

export const loadIdentity = (): TPlayerIdentity => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as TPlayerIdentity;
  } catch {
    // 프라이빗 모드 등 — 새 신원으로 진행
  }
  const identity: TPlayerIdentity = { playerId: crypto.randomUUID(), nickname: null };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  } catch {
    // 저장 실패 허용(세션 한정 신원)
  }
  return identity;
};

export const saveNickname = (nickname: string): void => {
  try {
    const identity = loadIdentity();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...identity, nickname }));
  } catch {
    // 저장 실패 허용
  }
};

// ── PeerJS 배선 ────────────────────────────────────────────────────

export interface TPlayerClientHandle {
  core: TPlayerCore;
  pushState: (payload: TStatePayload) => void; // 컨트롤러가 최신 판정 상태를 밀어넣음
  reportFall: (payload: TStatePayload) => void;
  destroy: () => void;
}

export interface TCreatePlayerClientOptions {
  roomId: string;
  playerId: string;
  nickname: string;
  onChange: () => void; // status/roster/results 변동 → 스토어 갱신
  onRejected: (reason: string) => void;
  onConnectFailed: () => void; // 10s 타임아웃·ICE 실패 등 — 재시도 UI
}

export const createPlayerClient = (
  options: TCreatePlayerClientOptions,
): TPlayerClientHandle => {
  let destroyed = false;
  let peer: Peer | null = null;
  let control: DataConnection | null = null;
  let stateChannel: DataConnection | null = null;
  let seq = 0;
  let latest: TStatePayload | null = null;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const core = createPlayerCore({
    now: () => Date.now(),
    send: (msg) => control?.send(msg),
  });

  const scheduleReconnect = (): void => {
    if (destroyed || core.getStatus() === "closed") return;
    reconnectTimer = setTimeout(() => {
      reconnectAttempt += 1;
      connect();
    }, nextReconnectDelay(reconnectAttempt));
  };

  const connect = (): void => {
    if (destroyed) return;
    peer?.destroy();
    peer = new Peer();
    const timeout = setTimeout(() => {
      if (!control?.open) {
        peer?.destroy();
        if (reconnectAttempt === 0) options.onConnectFailed();
        else scheduleReconnect();
      }
    }, CONNECT_TIMEOUT_MS);

    peer.on("open", () => {
      if (!peer || destroyed) return;
      control = peer.connect(options.roomId, {
        reliable: true,
        serialization: "json",
        metadata: { playerId: options.playerId, channel: "control" },
      });
      stateChannel = peer.connect(options.roomId, {
        reliable: false,
        serialization: "json",
        metadata: { playerId: options.playerId, channel: "state" },
      });
      control.on("open", () => {
        clearTimeout(timeout);
        reconnectAttempt = 0;
        control?.send({
          v: PROTOCOL_VERSION,
          type: "join",
          playerId: options.playerId,
          nickname: options.nickname,
        });
      });
      control.on("data", (raw) => {
        const msg = parseMessage(raw);
        if (!msg) return;
        if (msg.type === "join-rejected") options.onRejected(msg.reason);
        core.handleHostMsg(msg as THostMsg);
        options.onChange();
      });
      control.on("close", () => {
        if (!destroyed) scheduleReconnect();
      });
      control.on("error", () => {
        if (!destroyed) scheduleReconnect();
      });
    });
    peer.on("error", () => {
      clearTimeout(timeout);
      if (!destroyed) {
        if (reconnectAttempt === 0) options.onConnectFailed();
        else scheduleReconnect();
      }
    });
  };

  connect();

  const heartbeatTimer = setInterval(() => {
    control?.send({ v: PROTOCOL_VERSION, type: "heartbeat", t: Date.now() });
    core.tick();
    options.onChange();
  }, HEARTBEAT_INTERVAL_MS);

  const stateTimer = setInterval(() => {
    if (!latest || core.getStatus() !== "racing") return;
    const raceId = core.getRaceId();
    if (raceId === null) return;
    seq += 1;
    const msg: TPlayerMsg = {
      v: PROTOCOL_VERSION,
      type: "state",
      raceId,
      seq,
      ...latest,
    };
    // state 채널 우선, 미개통 시 control 폴백 + bufferedAmount 가드(그 틱 스킵 = 합침)
    if (stateChannel?.open) {
      stateChannel.send(msg);
    } else if (control?.open) {
      // peerjs 타입에 bufferedAmount가 없어 내부 RTCDataChannel에서 읽는다
      const buffered =
        (control as unknown as { dataChannel?: RTCDataChannel }).dataChannel
          ?.bufferedAmount ?? 0;
      if (buffered <= BUFFERED_AMOUNT_LIMIT) control.send(msg);
    }
  }, 1000 / STATE_SEND_HZ);

  const tickTimer = setInterval(() => {
    core.tick();
    options.onChange();
  }, 100);

  return {
    core,
    pushState: (payload) => {
      latest = payload;
    },
    reportFall: (payload) => {
      latest = payload;
      core.reportFall(payload.distance, payload.distanceReachedAt);
      options.onChange();
    },
    destroy: () => {
      destroyed = true;
      clearInterval(heartbeatTimer);
      clearInterval(stateTimer);
      clearInterval(tickTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      control?.close();
      stateChannel?.close();
      peer?.destroy();
    },
  };
};

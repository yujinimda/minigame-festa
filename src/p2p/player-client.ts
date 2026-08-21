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
  // 판정 진행값 주입 — 30초 완주 finish가 마지막 실제 기록을 싣도록(0보 완주 버그 방지)
  updateProgress(distance: number, distanceReachedAt: number | null): void;
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

  // reconnecting에서 복귀할 때는 레이스 진행 상황에 맞는 상태로 돌아간다(게이트8 B6) —
  // 무조건 joined로 내리면 남은 레이스 동안 state/finish 송신이 영구 중단된다
  const markHostSeen = (): void => {
    lastHostSeenAt = now();
    if (status !== "reconnecting") return;
    if (results !== null) {
      // 순위가 이미 확정된 판 — result 화면 유지(reconnecting 복귀가 컨트롤러로 이탈하지 않게)
      status = "result";
    } else if (raceStartReceivedAt !== null && !finishSent && !fallSent) {
      const elapsed = now() - raceStartReceivedAt;
      status =
        elapsed < countdownMs
          ? "countdown"
          : elapsed < countdownMs + durationMs
            ? "racing"
            : "finished";
    } else if (finishSent || fallSent) {
      status = "finished";
    } else {
      status = "joined";
    }
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
            // 재접속 복원: remainingMs = 전체 잔여(카운트다운 포함, 계약 §RoomSnapshot)로 역산
            const remaining = msg.snapshot.remainingMs ?? 0;
            raceStartReceivedAt = now() - (countdownMs + durationMs - remaining);
            if (msg.snapshot.ownRecord) {
              // 이미 확정된 기록 승계 — 로컬 타이머 만료 시 finish 중복 송신 방지
              finishSent = true;
              status = "finished";
            } else {
              status = msg.snapshot.phase === "race" ? "racing" : "countdown";
            }
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
          results = null; // 이전 판 순위가 새 판 화면에 남지 않게
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

    updateProgress(distance, distanceReachedAt) {
      if (finishSent || fallSent) return;
      lastDistance = distance;
      lastDistanceReachedAt = distanceReachedAt;
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

// crypto.randomUUID는 secure context 전용 — LAN http(실기기 개발 검증) 폴백 필수
const generatePlayerId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

export const loadIdentity = (): TPlayerIdentity => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as TPlayerIdentity;
  } catch {
    // 프라이빗 모드 등 — 새 신원으로 진행
  }
  const identity: TPlayerIdentity = { playerId: generatePlayerId(), nickname: null };
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
  let connectTimeout: ReturnType<typeof setTimeout> | null = null;
  // 연결 세대 토큰(게이트8 B2) — connect()가 다시 돌면 이전 세대의
  // close/error/timeout 콜백은 전부 무시된다(destroy 연쇄로 인한 재스케줄 폭주 방지)
  let generation = 0;

  const core = createPlayerCore({
    now: () => Date.now(),
    send: (msg) => {
      if (control?.open) control.send(msg);
    },
  });

  // 변경 감지 알림(게이트8 B9와 동일 원리) — status/roster/results가 바뀐 때만 스토어 갱신
  let lastSignature = "";
  const notifyIfChanged = (): void => {
    const results = core.getResults();
    const signature = [
      core.getStatus(),
      core.getNickname() ?? "-",
      core
        .getRoster()
        .map((r) => `${r.playerId}:${r.connected}`)
        .join(","),
      results ? results.map((r) => `${r.playerId}:${r.rank}`).join(",") : "-",
    ].join("|");
    if (signature !== lastSignature) {
      lastSignature = signature;
      options.onChange();
    }
  };

  // 재접속은 단일 pending 타이머로만(게이트8 B2) — 이미 예약돼 있으면 무시해 백오프 수열 유지
  const scheduleReconnect = (): void => {
    if (destroyed || core.getStatus() === "closed" || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      reconnectAttempt += 1;
      connect();
    }, nextReconnectDelay(reconnectAttempt));
  };

  const clearConnectTimeout = (): void => {
    if (connectTimeout) {
      clearTimeout(connectTimeout);
      connectTimeout = null;
    }
  };

  const connect = (): void => {
    if (destroyed) return;
    generation += 1;
    const gen = generation;
    const isStale = (): boolean => destroyed || gen !== generation;

    peer?.destroy(); // 이전 세대 정리 — 여기서 발화하는 close/error는 gen 가드로 무시됨
    peer = new Peer();

    clearConnectTimeout();
    connectTimeout = setTimeout(() => {
      connectTimeout = null;
      if (isStale() || control?.open) return; // 새 세대가 시작됐거나 이미 연결됨(게이트8 B3)
      peer?.destroy();
      if (reconnectAttempt === 0) options.onConnectFailed();
      else scheduleReconnect();
    }, CONNECT_TIMEOUT_MS);

    peer.on("open", () => {
      if (isStale() || !peer) return;
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
        if (isStale()) return;
        clearConnectTimeout();
        reconnectAttempt = 0;
        control?.send({
          v: PROTOCOL_VERSION,
          type: "join",
          playerId: options.playerId,
          nickname: options.nickname,
        });
      });
      control.on("data", (raw) => {
        if (isStale()) return;
        const msg = parseMessage(raw);
        if (!msg) return;
        if (msg.type === "join-rejected") {
          options.onRejected(msg.reason);
          destroy(); // 거부된 세션은 하트비트를 계속 보내지 않는다 — 재시도는 새 클라이언트로
          return;
        }
        core.handleHostMsg(msg as THostMsg);
        notifyIfChanged();
      });
      control.on("close", () => {
        if (!isStale()) scheduleReconnect();
      });
      control.on("error", () => {
        if (!isStale()) scheduleReconnect();
      });
    });
    peer.on("error", () => {
      if (isStale()) return;
      clearConnectTimeout();
      if (reconnectAttempt === 0) options.onConnectFailed();
      else scheduleReconnect();
    });
  };

  connect();

  const heartbeatTimer = setInterval(() => {
    if (control?.open) {
      control.send({ v: PROTOCOL_VERSION, type: "heartbeat", t: Date.now() });
    }
    core.tick();
    notifyIfChanged();
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
    // 계약 §연결 수명: ack 부재 6초도 재접속 트리거 — close 이벤트가 누락되는
    // 환경(iOS Safari)에서 status만 굳고 재시도가 없는 경로 방지
    if (core.getStatus() === "reconnecting") scheduleReconnect();
    notifyIfChanged();
  }, 100);

  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    clearInterval(heartbeatTimer);
    clearInterval(stateTimer);
    clearInterval(tickTimer);
    clearConnectTimeout();
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    control?.close();
    stateChannel?.close();
    peer?.destroy();
  };

  return {
    core,
    pushState: (payload) => {
      latest = payload;
      core.updateProgress(payload.distance, payload.distanceReachedAt);
    },
    reportFall: (payload) => {
      latest = payload;
      core.reportFall(payload.distance, payload.distanceReachedAt);
      notifyIfChanged();
    },
    destroy,
  };
};

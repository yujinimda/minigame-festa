// 플레이어 클라이언트 코어(PeerJS 무의존 순수 로직) 계약 테스트.
//
// 근거 매핑:
// - contracts/p2p-protocol.md §연결 수명 "플레이어 재접속은 1s→2s→4s(최대 10s)
//   백오프로 자동 재시도한다" (balance.RECONNECT_BACKOFF_MS)
//                                             → describe("nextReconnectDelay")
// - FR-007 · US2-AS1 게임 시작 시 컨트롤러 전환 + 카운트다운
// - contracts §race-start "플레이어는 수신 시점 기준 로컬 타이머(R4)"
// - FR-012 · contracts §finish "30초 로컬 타이머 종료 시 1회(생존 완주)"
//                                             → describe("레이스 로컬 타이머")
// - FR-011 · contracts §fall "넘어짐 순간 1회. 연출 트리거 + 기록 확정"
//                                             → describe("넘어짐 보고")
// - contracts §heartbeat-ack "플레이어 측 호스트 생존 판정의 근거: 마지막 호스트 수신
//   후 6초 무소식이면 재접속 백오프 시작, 20초까지 실패 지속 시 '방이 종료됨' 표시"
//   (HEARTBEAT_TIMEOUT_MS · ROOM_CLOSED_TIMEOUT_MS) → describe("호스트 생존 판정")
// - FR-015 · US3-AS2 race-end 수신 시 개인 결과 화면
// - FR-017 · US3-AS4 return-lobby 수신 시 대기 화면 → describe("phase 수신 처리")

import { beforeEach, describe, expect, it } from "vitest";

import {
  COUNTDOWN_MS,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  RACE_DURATION_MS,
  RECONNECT_BACKOFF_MS,
  ROOM_CLOSED_TIMEOUT_MS,
} from "@/src/game/balance";
import { createPlayerCore, nextReconnectDelay } from "@/src/p2p/player-client";
import {
  PROTOCOL_VERSION,
  type TFinishMsg,
  type THeartbeatAckMsg,
  type TJoinedMsg,
  type TPhase,
  type TPlayerMsg,
  type TRaceEndMsg,
  type TRaceStartMsg,
  type TReturnLobbyMsg,
} from "@/src/p2p/protocol";

const RACE_ID = 1;

const joinedMsg = (phase: TPhase = "lobby"): TJoinedMsg => ({
  v: PROTOCOL_VERSION,
  type: "joined",
  playerId: "p1",
  nickname: "지니",
  resumed: false,
  snapshot: {
    phase,
    raceId: phase === "lobby" ? null : RACE_ID,
    remainingMs: null,
    roster: [{ playerId: "p1", nickname: "지니", connected: true }],
    ownRecord: null,
    results: null,
  },
});

const raceStartMsg = (raceId = RACE_ID): TRaceStartMsg => ({
  v: PROTOCOL_VERSION,
  type: "race-start",
  raceId,
  countdownMs: COUNTDOWN_MS,
  durationMs: RACE_DURATION_MS,
});

const raceEndMsg = (raceId = RACE_ID): TRaceEndMsg => ({
  v: PROTOCOL_VERSION,
  type: "race-end",
  raceId,
  results: [{ playerId: "p1", nickname: "지니", distance: 12, fallen: false, rank: 1 }],
});

const returnLobbyMsg = (): TReturnLobbyMsg => ({
  v: PROTOCOL_VERSION,
  type: "return-lobby",
});

const heartbeatAckMsg = (t: number, hostT: number): THeartbeatAckMsg => ({
  v: PROTOCOL_VERSION,
  type: "heartbeat-ack",
  t,
  hostT,
});

const makePlayer = () => {
  let t = 0;
  const sent: TPlayerMsg[] = [];

  const core = createPlayerCore({
    now: () => t,
    send: (msg) => {
      sent.push(msg);
    },
  });

  const at = (next: number) => {
    t = next;
  };

  // 호스트 생존을 유지하면서 target까지 시간을 전진시킨다
  // (하트비트 타임아웃이 레이스 타이머 검증을 오염시키지 않게).
  const keepAliveTo = (target: number) => {
    while (t < target) {
      at(Math.min(t + HEARTBEAT_INTERVAL_MS, target));
      core.handleHostMsg(heartbeatAckMsg(t, t));
      core.tick();
    }
  };

  return {
    core,
    sent,
    at,
    keepAliveTo,
    now: () => t,
    countOf: (type: TPlayerMsg["type"]) => sent.filter((m) => m.type === type).length,
    firstOf: <K extends TPlayerMsg["type"]>(type: K) => {
      const found = sent.find((m): m is Extract<TPlayerMsg, { type: K }> => m.type === type);
      if (!found) throw new Error(`'${type}' 메시지가 송신되지 않았다`);
      return found;
    },
  };
};

type TPlayerHarness = ReturnType<typeof makePlayer>;

describe("nextReconnectDelay — 재접속 백오프 (contracts §연결 수명)", () => {
  it("첫 시도부터 백오프 상수 수열을 순서대로 반환한다", () => {
    RECONNECT_BACKOFF_MS.forEach((expected, attempt) => {
      expect(nextReconnectDelay(attempt)).toBe(expected);
    });
  });

  it("수열을 넘어선 시도는 마지막 값(최대 대기)을 유지한다", () => {
    const last = RECONNECT_BACKOFF_MS[RECONNECT_BACKOFF_MS.length - 1];

    expect(nextReconnectDelay(RECONNECT_BACKOFF_MS.length)).toBe(last);
    expect(nextReconnectDelay(RECONNECT_BACKOFF_MS.length + 1)).toBe(last);
    expect(nextReconnectDelay(99)).toBe(last);
  });
});

describe("플레이어 클라이언트 코어", () => {
  let h: TPlayerHarness;

  beforeEach(() => {
    h = makePlayer();
  });

  describe("phase 수신 처리 (FR-007 · FR-015 · FR-017)", () => {
    it("입장 전 상태는 idle이다", () => {
      expect(h.core.getStatus()).toBe("idle");
    });

    it("joined 수신 시 로비 대기(joined) 상태가 된다", () => {
      h.core.handleHostMsg(joinedMsg());

      expect(h.core.getStatus()).toBe("joined");
    });

    it("race-start 수신 시 countdown 상태로 전환한다", () => {
      h.core.handleHostMsg(joinedMsg());

      h.core.handleHostMsg(raceStartMsg());

      expect(h.core.getStatus()).toBe("countdown");
    });

    it("race-end 수신 시 result 상태가 된다", () => {
      h.core.handleHostMsg(joinedMsg());
      h.core.handleHostMsg(raceStartMsg());

      h.core.handleHostMsg(raceEndMsg());

      expect(h.core.getStatus()).toBe("result");
    });

    it("return-lobby 수신 시 로비 대기(joined) 상태로 돌아간다", () => {
      h.core.handleHostMsg(joinedMsg());
      h.core.handleHostMsg(raceStartMsg());
      h.core.handleHostMsg(raceEndMsg());

      h.core.handleHostMsg(returnLobbyMsg());

      expect(h.core.getStatus()).toBe("joined");
    });
  });

  describe("레이스 로컬 타이머 (contracts §race-start · FR-012)", () => {
    beforeEach(() => {
      h.at(0);
      h.core.handleHostMsg(joinedMsg());
      h.core.handleHostMsg(raceStartMsg());
    });

    it("카운트다운이 끝나기 전 tick은 countdown 상태를 유지한다", () => {
      h.at(COUNTDOWN_MS - 1);
      h.core.tick();

      expect(h.core.getStatus()).toBe("countdown");
    });

    it("수신 시점 기준 카운트다운 경과 tick으로 racing 상태가 된다", () => {
      h.at(COUNTDOWN_MS);
      h.core.tick();

      expect(h.core.getStatus()).toBe("racing");
    });

    it("30초가 끝나기 전에는 finish를 송신하지 않는다", () => {
      h.keepAliveTo(COUNTDOWN_MS + RACE_DURATION_MS - 1);

      expect(h.countOf("finish")).toBe(0);
      expect(h.core.getStatus()).toBe("racing");
    });

    it("로컬 30초 만료 tick에 finish를 정확히 1회 송신하고 finished 상태가 된다", () => {
      h.keepAliveTo(COUNTDOWN_MS + RACE_DURATION_MS);

      expect(h.countOf("finish")).toBe(1);
      expect(h.core.getStatus()).toBe("finished");

      const finish = h.firstOf("finish") as TFinishMsg;
      expect(finish.raceId).toBe(RACE_ID);
      expect(typeof finish.finishedAt).toBe("number");
    });

    it("만료 이후 tick을 반복해도 finish는 1회만 송신한다", () => {
      h.keepAliveTo(COUNTDOWN_MS + RACE_DURATION_MS);

      h.keepAliveTo(COUNTDOWN_MS + RACE_DURATION_MS + 10_000);
      h.core.tick();
      h.core.tick();

      expect(h.countOf("finish")).toBe(1);
      expect(h.core.getStatus()).toBe("finished");
    });
  });

  describe("넘어짐 보고 (FR-011 · contracts §fall)", () => {
    beforeEach(() => {
      h.at(0);
      h.core.handleHostMsg(joinedMsg());
      h.core.handleHostMsg(raceStartMsg());
      h.at(COUNTDOWN_MS);
      h.core.tick();
    });

    it("reportFall은 fall을 1회 송신하고 기록을 확정한다", () => {
      h.at(COUNTDOWN_MS + 5_000);

      h.core.reportFall(14, 4_800);

      expect(h.countOf("fall")).toBe(1);
      const fall = h.firstOf("fall");
      expect(fall.raceId).toBe(RACE_ID);
      expect(fall.distance).toBe(14);
      expect(fall.distanceReachedAt).toBe(4_800);
      expect(h.core.getStatus()).toBe("finished");
    });

    it("reportFall을 중복 호출해도 fall은 1회만 송신한다", () => {
      h.at(COUNTDOWN_MS + 5_000);

      h.core.reportFall(14, 4_800);
      h.core.reportFall(14, 4_800);
      h.core.reportFall(99, 5_000);

      expect(h.countOf("fall")).toBe(1);
    });

    it("넘어짐 이후에는 state 송신을 중단한다", () => {
      h.at(COUNTDOWN_MS + 5_000);
      h.core.reportFall(14, 4_800);
      const sentAfterFall = h.sent.length;

      h.keepAliveTo(COUNTDOWN_MS + 20_000);

      const later = h.sent.slice(sentAfterFall);
      expect(later.filter((m) => m.type === "state")).toHaveLength(0);
      expect(later.filter((m) => m.type === "fall")).toHaveLength(0);
    });

    it("넘어져 확정된 뒤에는 30초 만료로 finish를 송신하지 않는다(생존 완주 전용)", () => {
      h.at(COUNTDOWN_MS + 5_000);
      h.core.reportFall(14, 4_800);

      h.keepAliveTo(COUNTDOWN_MS + RACE_DURATION_MS + 1_000);

      expect(h.countOf("finish")).toBe(0);
    });
  });

  describe("호스트 생존 판정 (contracts §heartbeat-ack · §호스트 소멸)", () => {
    beforeEach(() => {
      h.at(0);
      h.core.handleHostMsg(joinedMsg());
    });

    it("타임아웃 직전 tick에서는 상태를 유지한다", () => {
      h.at(HEARTBEAT_TIMEOUT_MS - 1);
      h.core.tick();

      expect(h.core.getStatus()).toBe("joined");
    });

    it("마지막 호스트 수신 후 하트비트 타임아웃 초과 시 reconnecting 상태가 된다", () => {
      h.at(HEARTBEAT_TIMEOUT_MS);
      h.core.tick();

      expect(h.core.getStatus()).toBe("reconnecting");
    });

    it("heartbeat-ack 수신으로 마지막 호스트 수신 시각이 갱신된다", () => {
      const ackAt = HEARTBEAT_TIMEOUT_MS - 1;
      h.at(ackAt);
      h.core.handleHostMsg(heartbeatAckMsg(ackAt, ackAt));
      h.core.tick();
      expect(h.core.getStatus()).toBe("joined");

      h.at(ackAt + HEARTBEAT_TIMEOUT_MS - 1);
      h.core.tick();
      expect(h.core.getStatus()).toBe("joined");

      h.at(ackAt + HEARTBEAT_TIMEOUT_MS);
      h.core.tick();
      expect(h.core.getStatus()).toBe("reconnecting");
    });

    it("방 종료 타임아웃 직전에는 아직 reconnecting을 유지한다", () => {
      h.at(ROOM_CLOSED_TIMEOUT_MS - 1);
      h.core.tick();

      expect(h.core.getStatus()).toBe("reconnecting");
    });

    it("재접속 실패가 방 종료 타임아웃까지 지속되면 closed 상태가 된다", () => {
      h.at(HEARTBEAT_TIMEOUT_MS);
      h.core.tick();

      h.at(ROOM_CLOSED_TIMEOUT_MS);
      h.core.tick();

      expect(h.core.getStatus()).toBe("closed");
    });
  });
});

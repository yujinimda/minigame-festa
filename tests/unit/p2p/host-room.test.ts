// 호스트 방 코어(PeerJS 무의존 순수 로직) 계약 테스트.
//
// 근거 매핑:
// - FR-003 빈 닉네임 거부 / data-model.md §Player "입력 1~10자, 공백만은 거부,
//   방 내 중복 시 ' (2)' 접미사"            → describe("join — 닉네임 검증")
// - FR-004 최대 15명, 초과 거부 / contracts §연결 수명 "재접속은 신규로 세지 않는다"
//                                             → describe("join — 정원")
// - FR-020 로비 상태에서만 신규 입장 허용   → describe("join — phase 제한")
// - FR-026 재접속 시 닉네임·자리·확정 기록 승계(resumed:true + snapshot 복원)
// - FR-005 로비 참가자 목록(닉네임·연결 상태) 실시간
// - contracts §플레이어→호스트 heartbeat / §호스트→플레이어 heartbeat-ack
//                                             → describe("heartbeat")
// - FR-012 30초 제한 / US2-AS1 카운트다운 / data-model.md §Room 상태 전이
//                                             → describe("레이스 진행")
// - FR-013 상태만 주기 전송 + contracts §채널 (raceId, seq) 폐기 규칙
// - FR-019 레이스 중 끊김 → 끊김 시점 거리로 기록 확정(fallen false 유지)
// - FR-021 · US3-AS3 동점 3단계(distance ↓ → distanceReachedAt ↑ → join 수락 순서)
// - FR-017 · US3-AS4 다시 하기(멤버 유지, 기록 초기화, raceId 증가)

import { beforeEach, describe, expect, it } from "vitest";

import {
  COUNTDOWN_MS,
  MAX_PLAYERS,
  NICKNAME_MAX_LENGTH,
  RACE_DURATION_MS,
} from "@/src/game/balance";
import { createHostRoomCore } from "@/src/p2p/host-room";
import {
  PROTOCOL_VERSION,
  type THeartbeatMsg,
  type THostMsg,
  type TFallMsg,
  type TStateMsg,
} from "@/src/p2p/protocol";

type TSentEntry = { playerId: string; msg: THostMsg };

const lastOf = <K extends THostMsg["type"]>(msgs: THostMsg[], type: K) => {
  const found = [...msgs].reverse().find((m): m is Extract<THostMsg, { type: K }> => m.type === type);
  if (!found) throw new Error(`'${type}' 메시지가 발신되지 않았다`);
  return found;
};

const stateMsg = (
  raceId: number,
  seq: number,
  distance: number,
  distanceReachedAt: number | null,
): TStateMsg => ({
  v: PROTOCOL_VERSION,
  type: "state",
  raceId,
  seq,
  distance,
  tilt: 0,
  fallen: false,
  distanceReachedAt,
});

const fallMsg = (
  raceId: number,
  distance: number,
  distanceReachedAt: number | null,
  finishedAt: number,
): TFallMsg => ({
  v: PROTOCOL_VERSION,
  type: "fall",
  raceId,
  distance,
  distanceReachedAt,
  finishedAt,
});

const heartbeatMsg = (t: number): THeartbeatMsg => ({
  v: PROTOCOL_VERSION,
  type: "heartbeat",
  t,
});

const makeHost = () => {
  let t = 0;
  const sent: TSentEntry[] = [];
  const broadcasted: THostMsg[] = [];

  const core = createHostRoomCore({
    now: () => t,
    send: (playerId, msg) => {
      sent.push({ playerId, msg });
    },
    broadcast: (msg) => {
      broadcasted.push(msg);
    },
  });

  return {
    core,
    sent,
    broadcasted,
    at: (next: number) => {
      t = next;
    },
    msgsTo: (playerId: string) => sent.filter((e) => e.playerId === playerId).map((e) => e.msg),
    lastTo: <K extends THostMsg["type"]>(playerId: string, type: K) =>
      lastOf(
        sent.filter((e) => e.playerId === playerId).map((e) => e.msg),
        type,
      ),
  };
};

type THostHarness = ReturnType<typeof makeHost>;

// 로비 → countdown → race 까지 밀어 주는 헬퍼. 반환값은 현재 raceId.
const startRaceAt = (h: THostHarness, startedAt: number): number => {
  h.at(startedAt);
  h.core.startRace();
  const raceStart = lastOf(h.broadcasted, "race-start");
  h.at(startedAt + COUNTDOWN_MS);
  h.core.tick();
  return raceStart.raceId;
};

describe("호스트 방 코어", () => {
  let h: THostHarness;

  beforeEach(() => {
    h = makeHost();
  });

  describe("join — 닉네임 검증 (FR-003)", () => {
    it("빈 닉네임은 invalid-nickname으로 거부한다", () => {
      h.core.join("p1", "");

      expect(h.lastTo("p1", "join-rejected").reason).toBe("invalid-nickname");
      expect(h.core.getRoster()).toHaveLength(0);
    });

    it("공백만 있는 닉네임은 invalid-nickname으로 거부한다", () => {
      h.core.join("p1", "   ");

      expect(h.lastTo("p1", "join-rejected").reason).toBe("invalid-nickname");
      expect(h.core.getRoster()).toHaveLength(0);
    });

    it("신규 참가자가 닉네임을 생략하면 invalid-nickname으로 거부한다", () => {
      h.core.join("p1", undefined);

      expect(h.lastTo("p1", "join-rejected").reason).toBe("invalid-nickname");
      expect(h.core.getRoster()).toHaveLength(0);
    });

    it("최대 길이를 초과한 닉네임은 invalid-nickname으로 거부한다", () => {
      h.core.join("p1", "가".repeat(NICKNAME_MAX_LENGTH + 1));

      expect(h.lastTo("p1", "join-rejected").reason).toBe("invalid-nickname");
      expect(h.core.getRoster()).toHaveLength(0);
    });

    it("최대 길이와 같은 닉네임은 허용한다", () => {
      const nickname = "가".repeat(NICKNAME_MAX_LENGTH);

      h.core.join("p1", nickname);

      expect(h.lastTo("p1", "joined").nickname).toBe(nickname);
    });

    it("중복 닉네임에는 ' (2)' 접미사를 붙인 확정값을 joined로 알린다", () => {
      h.core.join("p1", "지니");
      h.core.join("p2", "지니");

      expect(h.lastTo("p1", "joined").nickname).toBe("지니");
      expect(h.lastTo("p2", "joined").nickname).toBe("지니 (2)");
      expect(h.core.getRoster().map((r) => r.nickname)).toEqual(["지니", "지니 (2)"]);
    });
  });

  describe("join — 정원 (FR-004)", () => {
    const fillRoom = () => {
      for (let i = 0; i < MAX_PLAYERS; i += 1) h.core.join(`p${i}`, `참가자${i}`);
    };

    it("정원까지는 모두 수락한다", () => {
      fillRoom();

      expect(h.core.getRoster()).toHaveLength(MAX_PLAYERS);
    });

    it("정원을 초과한 신규 입장은 room-full로 거부한다", () => {
      fillRoom();

      h.core.join("overflow", "늦둥이");

      expect(h.lastTo("overflow", "join-rejected").reason).toBe("room-full");
      expect(h.core.getRoster()).toHaveLength(MAX_PLAYERS);
    });

    it("재접속(기존 playerId)은 정원에 산입하지 않고 기존 닉네임을 승계한다", () => {
      fillRoom();
      h.core.markDisconnected("p0");

      h.core.join("p0", undefined);

      const joined = h.lastTo("p0", "joined");
      expect(joined.resumed).toBe(true);
      expect(joined.nickname).toBe("참가자0");
      expect(h.core.getRoster()).toHaveLength(MAX_PLAYERS);
      expect(h.core.getRoster().find((r) => r.playerId === "p0")?.connected).toBe(true);
    });
  });

  describe("join — phase 제한 (FR-020) 과 재접속 예외 (FR-026)", () => {
    beforeEach(() => {
      h.core.join("p1", "지니");
      h.core.join("p2", "미나");
    });

    it("카운트다운 중 신규 입장은 race-in-progress로 거부한다", () => {
      h.at(0);
      h.core.startRace();

      h.core.join("late", "늦둥이");

      expect(h.core.getPhase()).toBe("countdown");
      expect(h.lastTo("late", "join-rejected").reason).toBe("race-in-progress");
      expect(h.core.getRoster()).toHaveLength(2);
    });

    it("레이스 중 신규 입장은 race-in-progress로 거부한다", () => {
      startRaceAt(h, 0);

      h.core.join("late", "늦둥이");

      expect(h.core.getPhase()).toBe("race");
      expect(h.lastTo("late", "join-rejected").reason).toBe("race-in-progress");
    });

    it("결과 화면에서도 신규 입장은 race-in-progress로 거부한다", () => {
      startRaceAt(h, 0);
      h.at(COUNTDOWN_MS + RACE_DURATION_MS);
      h.core.tick();

      h.core.join("late", "늦둥이");

      expect(h.core.getPhase()).toBe("result");
      expect(h.lastTo("late", "join-rejected").reason).toBe("race-in-progress");
    });

    it("레이스 중 재접속은 허용하고 resumed:true + 현재 phase 스냅샷을 준다", () => {
      const raceId = startRaceAt(h, 0);
      h.core.markDisconnected("p1");

      h.core.join("p1", undefined);

      const joined = h.lastTo("p1", "joined");
      expect(joined.resumed).toBe(true);
      expect(joined.nickname).toBe("지니");
      expect(joined.snapshot.phase).toBe("race");
      expect(joined.snapshot.phase).toBe(h.core.getPhase());
      expect(joined.snapshot.raceId).toBe(raceId);
      expect(joined.snapshot.roster.map((r) => r.playerId)).toEqual(["p1", "p2"]);
    });

    it("카운트다운 중 재접속 스냅샷의 phase는 countdown이다", () => {
      h.at(0);
      h.core.startRace();

      h.core.join("p2", undefined);

      const joined = h.lastTo("p2", "joined");
      expect(joined.resumed).toBe(true);
      expect(joined.snapshot.phase).toBe("countdown");
      expect(joined.snapshot.phase).toBe(h.core.getPhase());
    });
  });

  describe("heartbeat (contracts §heartbeat-ack)", () => {
    it("heartbeat 수신 시 t를 에코한 heartbeat-ack와 호스트 시각을 응답한다", () => {
      h.core.join("p1", "지니");
      h.at(5_000);

      h.core.handleMessage("p1", heartbeatMsg(1_234));

      const ack = h.lastTo("p1", "heartbeat-ack");
      expect(ack.t).toBe(1_234);
      expect(ack.hostT).toBe(5_000);
    });
  });

  describe("레이스 진행 (US2-AS1 · FR-012 · data-model.md 상태 전이)", () => {
    beforeEach(() => {
      h.core.join("p1", "지니");
      h.core.join("p2", "미나");
    });

    it("startRace는 countdown phase로 들어가며 race-start를 브로드캐스트한다", () => {
      h.at(0);

      h.core.startRace();

      const raceStart = lastOf(h.broadcasted, "race-start");
      expect(h.core.getPhase()).toBe("countdown");
      expect(raceStart.raceId).toBe(1);
      expect(raceStart.countdownMs).toBe(COUNTDOWN_MS);
      expect(raceStart.durationMs).toBe(RACE_DURATION_MS);
    });

    it("카운트다운이 끝나기 전 tick은 phase를 바꾸지 않는다", () => {
      h.at(0);
      h.core.startRace();

      h.at(COUNTDOWN_MS - 1);
      h.core.tick();

      expect(h.core.getPhase()).toBe("countdown");
    });

    it("카운트다운 경과 tick으로 race phase로 전이한다", () => {
      h.at(0);
      h.core.startRace();

      h.at(COUNTDOWN_MS);
      h.core.tick();

      expect(h.core.getPhase()).toBe("race");
    });

    it("레이스 마감 전 tick은 race phase를 유지한다", () => {
      startRaceAt(h, 0);

      h.at(COUNTDOWN_MS + RACE_DURATION_MS - 1);
      h.core.tick();

      expect(h.core.getPhase()).toBe("race");
      expect(h.broadcasted.filter((m) => m.type === "race-end")).toHaveLength(0);
    });

    it("레이스 마감 tick으로 result phase로 전이하고 race-end를 브로드캐스트한다", () => {
      const raceId = startRaceAt(h, 0);

      h.at(COUNTDOWN_MS + RACE_DURATION_MS);
      h.core.tick();

      const raceEnd = lastOf(h.broadcasted, "race-end");
      expect(h.core.getPhase()).toBe("result");
      expect(raceEnd.raceId).toBe(raceId);
      expect(raceEnd.results).toHaveLength(2);
    });
  });

  describe("state 스냅샷 폐기 (FR-013 · contracts §채널 구성)", () => {
    beforeEach(() => {
      h.core.join("p1", "지니");
      h.core.join("p2", "미나");
    });

    it("낮은 seq 스냅샷은 폐기하고 최신 seq만 기록에 반영한다", () => {
      const raceId = startRaceAt(h, 0);

      h.core.handleMessage("p1", stateMsg(raceId, 5, 10, 4_000));
      h.core.handleMessage("p1", stateMsg(raceId, 3, 99, 1_000));
      h.core.handleMessage("p1", stateMsg(raceId, 5, 88, 1_000));

      h.at(COUNTDOWN_MS + RACE_DURATION_MS);
      h.core.tick();

      const result = lastOf(h.broadcasted, "race-end").results.find((r) => r.playerId === "p1");
      expect(result?.distance).toBe(10);
    });

    it("이전 raceId 스냅샷은 폐기한다", () => {
      const raceId = startRaceAt(h, 0);

      h.core.handleMessage("p1", stateMsg(raceId, 1, 7, 2_000));
      h.core.handleMessage("p1", stateMsg(raceId - 1, 999, 500, 100));

      h.at(COUNTDOWN_MS + RACE_DURATION_MS);
      h.core.tick();

      const result = lastOf(h.broadcasted, "race-end").results.find((r) => r.playerId === "p1");
      expect(result?.distance).toBe(7);
    });
  });

  describe("레이스 중 끊김 (FR-019)", () => {
    beforeEach(() => {
      h.core.join("p1", "지니");
      h.core.join("p2", "미나");
    });

    it("마지막 수신 state의 distance로 기록을 확정하고 fallen은 false로 유지한다", () => {
      const raceId = startRaceAt(h, 0);
      h.core.handleMessage("p1", stateMsg(raceId, 1, 12, 3_000));
      h.core.handleMessage("p1", stateMsg(raceId, 2, 25, 8_000));

      h.at(COUNTDOWN_MS + 10_000);
      h.core.markDisconnected("p1");

      expect(h.core.getRoster().find((r) => r.playerId === "p1")?.connected).toBe(false);

      h.at(COUNTDOWN_MS + RACE_DURATION_MS);
      h.core.tick();

      const result = lastOf(h.broadcasted, "race-end").results.find((r) => r.playerId === "p1");
      expect(result?.distance).toBe(25);
      expect(result?.fallen).toBe(false);
    });

    it("끊김 후 도착한 지연 state는 확정 기록을 덮어쓰지 않는다", () => {
      const raceId = startRaceAt(h, 0);
      h.core.handleMessage("p1", stateMsg(raceId, 1, 12, 3_000));

      h.at(COUNTDOWN_MS + 5_000);
      h.core.markDisconnected("p1");
      h.core.handleMessage("p1", stateMsg(raceId, 2, 40, 6_000));

      h.at(COUNTDOWN_MS + RACE_DURATION_MS);
      h.core.tick();

      const result = lastOf(h.broadcasted, "race-end").results.find((r) => r.playerId === "p1");
      expect(result?.distance).toBe(12);
    });

    it("fall 수신 시 기록을 fallen true로 확정한다 (FR-011)", () => {
      const raceId = startRaceAt(h, 0);
      h.core.handleMessage("p1", stateMsg(raceId, 1, 18, 6_000));

      h.core.handleMessage("p1", fallMsg(raceId, 18, 6_000, 7_000));

      h.at(COUNTDOWN_MS + RACE_DURATION_MS);
      h.core.tick();

      const result = lastOf(h.broadcasted, "race-end").results.find((r) => r.playerId === "p1");
      expect(result?.distance).toBe(18);
      expect(result?.fallen).toBe(true);
    });
  });

  describe("순위 집계 3단계 타이브레이크 (FR-021 · US3-AS1·AS3)", () => {
    // join 수락 순서: a → b → c → d → e → f
    beforeEach(() => {
      ["a", "b", "c", "d", "e", "f"].forEach((id) => h.core.join(id, id.toUpperCase()));
    });

    const finishRace = () => {
      h.at(COUNTDOWN_MS + RACE_DURATION_MS);
      h.core.tick();
      return lastOf(h.broadcasted, "race-end").results;
    };

    it("distance 내림차순 → distanceReachedAt 오름차순 → join 수락 순서로 유일한 rank를 매긴다", () => {
      const raceId = startRaceAt(h, 0);
      // d: 최대 거리
      h.core.handleMessage("d", stateMsg(raceId, 1, 20, 9_000));
      // b: 거리 동일, 먼저 도달
      h.core.handleMessage("b", stateMsg(raceId, 1, 10, 3_000));
      // a, c: 거리·도달 시각까지 동일 → join 순서(a < c)
      h.core.handleMessage("a", stateMsg(raceId, 1, 10, 5_000));
      h.core.handleMessage("c", stateMsg(raceId, 1, 10, 5_000));
      // e, f: 전진 0회(distance 0 · distanceReachedAt null) → join 순서(e < f)

      const results = finishRace();
      const rankOf = (playerId: string) => results.find((r) => r.playerId === playerId)?.rank;

      expect(rankOf("d")).toBe(1);
      expect(rankOf("b")).toBe(2);
      expect(rankOf("a")).toBe(3);
      expect(rankOf("c")).toBe(4);
      expect(rankOf("e")).toBe(5);
      expect(rankOf("f")).toBe(6);
    });

    it("rank는 1부터 참가자 수까지 중복 없이 유일하다", () => {
      const raceId = startRaceAt(h, 0);
      ["a", "b", "c", "d", "e", "f"].forEach((id) =>
        h.core.handleMessage(id, stateMsg(raceId, 1, 10, 5_000)),
      );

      const results = finishRace();

      expect([...results].map((r) => r.rank).sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(new Set(results.map((r) => r.rank)).size).toBe(results.length);
    });

    it("결과는 거리 내림차순으로 정렬되어 발신된다", () => {
      const raceId = startRaceAt(h, 0);
      h.core.handleMessage("a", stateMsg(raceId, 1, 5, 4_000));
      h.core.handleMessage("b", stateMsg(raceId, 1, 30, 8_000));
      h.core.handleMessage("c", stateMsg(raceId, 1, 17, 7_000));

      const results = finishRace();

      expect(results.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(results.slice(0, 3).map((r) => r.playerId)).toEqual(["b", "c", "a"]);
    });
  });

  describe("다시 하기 (FR-017 · US3-AS4)", () => {
    beforeEach(() => {
      h.core.join("p1", "지니");
      h.core.join("p2", "미나");
    });

    it("return-lobby를 브로드캐스트하고 lobby phase로 돌아간다", () => {
      startRaceAt(h, 0);
      h.at(COUNTDOWN_MS + RACE_DURATION_MS);
      h.core.tick();

      h.core.returnLobby();

      expect(lastOf(h.broadcasted, "return-lobby").type).toBe("return-lobby");
      expect(h.core.getPhase()).toBe("lobby");
    });

    it("멤버(roster)는 유지한다", () => {
      startRaceAt(h, 0);
      h.at(COUNTDOWN_MS + RACE_DURATION_MS);
      h.core.tick();

      h.core.returnLobby();

      expect(h.core.getRoster().map((r) => r.playerId)).toEqual(["p1", "p2"]);
      expect(h.core.getRoster().map((r) => r.nickname)).toEqual(["지니", "미나"]);
    });

    it("raceId가 1 증가해 이전 판 지연 메시지가 오염시키지 못한다", () => {
      const firstRaceId = startRaceAt(h, 0);
      h.at(COUNTDOWN_MS + RACE_DURATION_MS);
      h.core.tick();
      h.core.returnLobby();

      const secondRaceId = startRaceAt(h, 100_000);

      expect(secondRaceId).toBe(firstRaceId + 1);
    });

    it("이전 판 기록을 초기화한다", () => {
      const firstRaceId = startRaceAt(h, 0);
      h.core.handleMessage("p1", stateMsg(firstRaceId, 1, 42, 5_000));
      h.at(COUNTDOWN_MS + RACE_DURATION_MS);
      h.core.tick();
      h.core.returnLobby();

      const base = 100_000;
      startRaceAt(h, base);
      h.at(base + COUNTDOWN_MS + RACE_DURATION_MS);
      h.core.tick();

      const results = lastOf(h.broadcasted, "race-end").results;
      expect(results.map((r) => r.distance)).toEqual([0, 0]);
      expect(results.every((r) => r.fallen === false)).toBe(true);
    });
  });
});

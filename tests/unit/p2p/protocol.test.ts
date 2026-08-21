// 프로토콜 수신 유효성 계약 테스트.
//
// 근거 매핑:
// - contracts/p2p-protocol.md §공통 필드
//   "모든 메시지: { v: 1, type: string }. 알 수 없는 type은 무시(전방 호환)."
//   → parseMessage: 버전 불일치·미지 type·비객체는 폐기(null)
// - contracts/p2p-protocol.md §채널 구성
//   "수신 측은 (raceId, seq)로 오래된 스냅샷을 폐기한다: 저장된 최대 seq 이하이거나
//    현재 raceId와 다르면 무시."
//   → isStaleState (FR-013 · FR-014의 실시간 반영 정확성 전제)
// - data-model.md §PlayerRaceState seq "판 내 스냅샷 단조 증가 번호"

import { describe, expect, it } from "vitest";

import {
  PROTOCOL_VERSION,
  isStaleState,
  parseMessage,
  type TJoinMsg,
  type THeartbeatAckMsg,
} from "@/src/p2p/protocol";

describe("parseMessage — 수신 메시지 폐기 규칙", () => {
  it("객체가 아닌 값은 폐기한다", () => {
    expect(parseMessage(null)).toBeNull();
    expect(parseMessage(undefined)).toBeNull();
    expect(parseMessage("join")).toBeNull();
    expect(parseMessage(42)).toBeNull();
  });

  it("프로토콜 버전이 다르면 폐기한다", () => {
    expect(parseMessage({ v: PROTOCOL_VERSION + 1, type: "join", playerId: "p1" })).toBeNull();
    expect(parseMessage({ v: "1", type: "join", playerId: "p1" })).toBeNull();
  });

  it("버전 필드가 없으면 폐기한다", () => {
    expect(parseMessage({ type: "join", playerId: "p1" })).toBeNull();
  });

  it("type이 없거나 문자열이 아니면 폐기한다", () => {
    expect(parseMessage({ v: PROTOCOL_VERSION })).toBeNull();
    expect(parseMessage({ v: PROTOCOL_VERSION, type: 7 })).toBeNull();
  });

  it("알 수 없는 type은 폐기한다(전방 호환)", () => {
    expect(parseMessage({ v: PROTOCOL_VERSION, type: "future-message", foo: 1 })).toBeNull();
  });

  it("정상 플레이어 메시지는 그대로 통과시킨다", () => {
    const raw = { v: PROTOCOL_VERSION, type: "join", playerId: "p1", nickname: "지니" };

    const parsed = parseMessage(raw);

    expect(parsed).not.toBeNull();
    expect((parsed as TJoinMsg).type).toBe("join");
    expect((parsed as TJoinMsg).playerId).toBe("p1");
    expect((parsed as TJoinMsg).nickname).toBe("지니");
  });

  it("정상 호스트 메시지는 그대로 통과시킨다", () => {
    const raw = { v: PROTOCOL_VERSION, type: "heartbeat-ack", t: 100, hostT: 120 };

    const parsed = parseMessage(raw);

    expect(parsed).not.toBeNull();
    expect((parsed as THeartbeatAckMsg).type).toBe("heartbeat-ack");
    expect((parsed as THeartbeatAckMsg).t).toBe(100);
    expect((parsed as THeartbeatAckMsg).hostT).toBe(120);
  });
});

describe("isStaleState — 오래된 스냅샷 폐기 규칙", () => {
  it("현재 raceId와 다른 스냅샷은 폐기한다(이전 판 지연 메시지 오염 방지)", () => {
    expect(isStaleState({ raceId: 1, seq: 999 }, 2, 0)).toBe(true);
    expect(isStaleState({ raceId: 3, seq: 999 }, 2, 0)).toBe(true);
  });

  it("저장된 최대 seq와 같은 스냅샷은 폐기한다", () => {
    expect(isStaleState({ raceId: 1, seq: 10 }, 1, 10)).toBe(true);
  });

  it("저장된 최대 seq보다 작은 스냅샷은 폐기한다", () => {
    expect(isStaleState({ raceId: 1, seq: 9 }, 1, 10)).toBe(true);
  });

  it("같은 raceId에서 seq가 더 큰 신규 스냅샷은 통과시킨다", () => {
    expect(isStaleState({ raceId: 1, seq: 11 }, 1, 10)).toBe(false);
    expect(isStaleState({ raceId: 1, seq: 1 }, 1, 0)).toBe(false);
  });
});

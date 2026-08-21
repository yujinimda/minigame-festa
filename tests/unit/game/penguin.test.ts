/**
 * 펭귄 빙판 걷기 — 로컬 판정 엔진 계약 테스트 (TDD: 구현 이전에 작성)
 *
 * 대상: src/game/penguin.ts (createRaceState / applyTap / applyDrift)
 * 판정은 참가자 기기에서 수행한다(FR-013) — 순수 함수로 상태 전이만 검증한다.
 *
 * 근거 매핑
 * - FR-008 (US2-AS2): 좌우 교대 탭 → 전진 + 기울기 소폭 회복
 *   → "좌우를 교대로 탭하면...", "회복은 0을 지나쳐...", "첫 탭은..."
 * - FR-009 (US2-AS3): 같은 쪽 연속 탭 → 그 방향으로 기울기 크게 증가, 전진 없음
 *   → "같은 쪽을 연속으로 탭하면...", "좌/우 연속 탭의 기울기 부호는..."
 * - FR-010 (US2-AS5): 입력 공백 시 기울기가 서서히 랜덤 방향으로 증가
 *   → "마지막 탭 후 DRIFT_GRACE_MS 안...", "드리프트는 dt 비례...", "드리프트 방향은 유지..."
 * - FR-011 (US2-AS4): abs(tilt) >= TILT_LIMIT 되는 순간 넘어짐 + 기록 확정
 *   → "같은 쪽 연속 탭으로 한계에...", "드리프트로 한계에...", "넘어진 뒤에는..."
 * - Edge case(spec §Edge Cases, MIN_TAP_INTERVAL_MS): 비정상 연타 무시
 *   → "직전 탭과의 간격이 MIN_TAP_INTERVAL_MS 미만..."
 * - data-model.md §PlayerRaceState: 초기값, distance 단조 증가, tilt 원시값(클램프 없음),
 *   distanceReachedAt = 마지막 전진 시각(FR-021 타이브레이크 값)
 *
 * 범위 밖: FR-012(30초 제한시간)는 레이스 타이머 소관이며 이 모듈의 계약이 아니다.
 * 모든 기대값은 src/game/balance.ts 상수에서 가져온다(숫자 하드코딩 금지).
 */

import { describe, expect, it } from "vitest";

import {
  DRIFT_GRACE_MS,
  DRIFT_PER_SEC,
  MIN_TAP_INTERVAL_MS,
  STEP_DISTANCE,
  TILT_LIMIT,
  TILT_PENALTY_SAME_SIDE,
  TILT_RECOVER_PER_STEP,
} from "@/src/game/balance";
import { applyDrift, applyTap, createRaceState } from "@/src/game/penguin";

/** 드리프트 방향을 고정 주입한 초기 상태 (기본값은 랜덤이므로 테스트에서는 항상 주입) */
const freshState = (driftDirection: 1 | -1 = 1) => createRaceState({ driftDirection });

/** 같은 쪽 연속 탭 n회를 MIN_TAP_INTERVAL_MS 이상 간격으로 적용 */
const tapSameSideTimes = (
  side: "L" | "R",
  times: number,
  driftDirection: 1 | -1 = 1,
) => {
  const step = MIN_TAP_INTERVAL_MS * 2;
  let state = freshState(driftDirection);
  for (let i = 0; i < times; i += 1) {
    state = applyTap(state, side, i * step);
  }
  return state;
};

describe("createRaceState — 레이스 상태 초기값 (data-model.md §PlayerRaceState)", () => {
  it("초기 상태는 distance 0, tilt 0, fallen false, distanceReachedAt/finishedAt null, seq 0, lastSide/lastTapAt null이다", () => {
    const state = createRaceState();

    expect(state.distance).toBe(0);
    expect(state.tilt).toBe(0);
    expect(state.fallen).toBe(false);
    expect(state.distanceReachedAt).toBeNull();
    expect(state.finishedAt).toBeNull();
    expect(state.seq).toBe(0);
    expect(state.lastSide).toBeNull();
    expect(state.lastTapAt).toBeNull();
  });

  it("드리프트 방향을 주입해도 초기 상태의 관측 가능한 값은 동일하다", () => {
    expect(freshState(1).tilt).toBe(0);
    expect(freshState(-1).tilt).toBe(0);
  });
});

describe("applyTap — 좌우 교대 탭 (FR-008 / US2-AS2)", () => {
  it("첫 탭(lastSide가 null)은 전진으로 취급되어 distance가 STEP_DISTANCE만큼 증가한다", () => {
    const next = applyTap(freshState(), "L", 0);

    expect(next.distance).toBe(STEP_DISTANCE);
    expect(next.tilt).toBe(0);
    expect(next.fallen).toBe(false);
    expect(next.distanceReachedAt).toBe(0);
  });

  it("좌우를 교대로 탭하면 distance가 STEP_DISTANCE만큼 증가하고 distanceReachedAt이 now로 갱신된다", () => {
    const first = applyTap(freshState(), "L", 0);
    const tapAt = MIN_TAP_INTERVAL_MS * 2;
    const second = applyTap(first, "R", tapAt);

    expect(second.distance).toBe(STEP_DISTANCE * 2);
    expect(second.distanceReachedAt).toBe(tapAt);
    expect(second.fallen).toBe(false);
  });

  it("교대 탭은 기울기 절댓값을 TILT_RECOVER_PER_STEP만큼 0 방향으로 회복시킨다", () => {
    // 같은 쪽 2회로 기울기를 만든 뒤(부호는 구현의 좌우 규약에 맡긴다) 반대쪽 탭으로 회복
    const tilted = tapSameSideTimes("L", 2);
    expect(Math.abs(tilted.tilt)).toBe(TILT_PENALTY_SAME_SIDE);

    const recovered = applyTap(tilted, "R", MIN_TAP_INTERVAL_MS * 4);

    expect(Math.abs(recovered.tilt)).toBe(TILT_PENALTY_SAME_SIDE - TILT_RECOVER_PER_STEP);
    expect(Math.sign(recovered.tilt)).toBe(Math.sign(tilted.tilt));
    expect(recovered.distance).toBe(tilted.distance + STEP_DISTANCE);
  });

  it("회복은 0을 지나쳐 반대 부호가 되지 않고 정확히 0에서 멈춘다", () => {
    // TILT_RECOVER_PER_STEP보다 작은 기울기를 드리프트로 만든다
    const smallTiltDtMs = Math.floor(((TILT_RECOVER_PER_STEP / 2) / DRIFT_PER_SEC) * 1000);
    const tapped = applyTap(freshState(1), "L", 0);
    const drifted = applyDrift(tapped, smallTiltDtMs, DRIFT_GRACE_MS * 2 + smallTiltDtMs);

    expect(Math.abs(drifted.tilt)).toBeGreaterThan(0);
    expect(Math.abs(drifted.tilt)).toBeLessThan(TILT_RECOVER_PER_STEP);

    const recovered = applyTap(drifted, "R", DRIFT_GRACE_MS * 2 + smallTiltDtMs);

    expect(recovered.tilt).toBe(0);
  });

  it("applyTap은 입력 상태를 변경하지 않는 순수 함수다", () => {
    const state = applyTap(freshState(), "L", 0);
    const before = structuredClone(state);

    const next = applyTap(state, "R", MIN_TAP_INTERVAL_MS * 2);

    expect(state).toEqual(before);
    expect(next).not.toBe(state);
  });
});

describe("applyTap — 같은 쪽 연속 탭 (FR-009 / US2-AS3)", () => {
  it("같은 쪽을 연속으로 탭하면 기울기가 TILT_PENALTY_SAME_SIDE만큼 증가하고 distance는 증가하지 않는다", () => {
    const first = applyTap(freshState(), "R", 0);
    const second = applyTap(first, "R", MIN_TAP_INTERVAL_MS * 2);

    expect(Math.abs(second.tilt)).toBe(TILT_PENALTY_SAME_SIDE);
    expect(second.distance).toBe(first.distance);
  });

  it("같은 쪽 연속 탭은 distanceReachedAt을 갱신하지 않는다 (마지막 전진 시각 유지 — FR-021)", () => {
    const first = applyTap(freshState(), "R", 0);
    const second = applyTap(first, "R", MIN_TAP_INTERVAL_MS * 2);

    expect(second.distanceReachedAt).toBe(first.distanceReachedAt);
  });

  it("좌 연속 탭과 우 연속 탭의 기울기 부호는 서로 반대다 (그 방향으로 기울어짐)", () => {
    const leftTilt = tapSameSideTimes("L", 2).tilt;
    const rightTilt = tapSameSideTimes("R", 2).tilt;

    expect(Math.sign(leftTilt)).toBe(-Math.sign(rightTilt));
    expect(Math.abs(leftTilt)).toBe(TILT_PENALTY_SAME_SIDE);
    expect(Math.abs(rightTilt)).toBe(TILT_PENALTY_SAME_SIDE);
  });
});

describe("applyTap — 최소 입력 간격 (spec §Edge Cases, MIN_TAP_INTERVAL_MS)", () => {
  it("직전 탭과의 간격이 MIN_TAP_INTERVAL_MS 미만이면 입력을 무시하고 상태가 완전히 동일하다", () => {
    const state = applyTap(freshState(), "L", 0);

    const ignored = applyTap(state, "R", MIN_TAP_INTERVAL_MS - 1);

    expect(ignored).toEqual(state);
  });

  it("간격이 MIN_TAP_INTERVAL_MS와 같으면 입력이 정상 처리된다 (미만만 무시)", () => {
    const state = applyTap(freshState(), "L", 0);

    const accepted = applyTap(state, "R", MIN_TAP_INTERVAL_MS);

    expect(accepted.distance).toBe(state.distance + STEP_DISTANCE);
    expect(accepted.distanceReachedAt).toBe(MIN_TAP_INTERVAL_MS);
  });

  it("같은 쪽 연타도 MIN_TAP_INTERVAL_MS 미만이면 기울기 페널티가 적용되지 않는다", () => {
    const state = applyTap(freshState(), "L", 0);

    const ignored = applyTap(state, "L", MIN_TAP_INTERVAL_MS - 1);

    expect(ignored.tilt).toBe(state.tilt);
    expect(ignored).toEqual(state);
  });
});

describe("applyDrift — 입력 공백 시 기울기 흐름 (FR-010 / US2-AS5)", () => {
  it("마지막 탭 후 DRIFT_GRACE_MS 안이면 드리프트가 0이다", () => {
    const tapped = applyTap(freshState(1), "L", 0);

    const drifted = applyDrift(tapped, DRIFT_GRACE_MS / 2, DRIFT_GRACE_MS / 2);

    expect(drifted.tilt).toBe(0);
    expect(drifted.fallen).toBe(false);
  });

  it("DRIFT_GRACE_MS를 넘기면 주입한 방향으로 dt초당 DRIFT_PER_SEC씩 기울기가 증가한다", () => {
    const dt = 400;
    const now = DRIFT_GRACE_MS * 2 + dt;
    const tapped = applyTap(freshState(1), "L", 0);

    const drifted = applyDrift(tapped, dt, now);

    expect(drifted.tilt).toBeCloseTo((DRIFT_PER_SEC * dt) / 1000, 6);
  });

  it("주입한 드리프트 방향이 -1이면 기울기가 반대 부호로 증가한다", () => {
    const dt = 400;
    const now = DRIFT_GRACE_MS * 2 + dt;
    const tapped = applyTap(freshState(-1), "L", 0);

    const drifted = applyDrift(tapped, dt, now);

    expect(drifted.tilt).toBeCloseTo((-DRIFT_PER_SEC * dt) / 1000, 6);
  });

  it("드리프트 방향은 연속 호출에서도 유지되어 기울기가 누적된다", () => {
    const dt = 200;
    const base = DRIFT_GRACE_MS * 2;
    const tapped = applyTap(freshState(1), "L", 0);

    const once = applyDrift(tapped, dt, base + dt);
    const twice = applyDrift(once, dt, base + dt * 2);

    expect(twice.tilt).toBeCloseTo((DRIFT_PER_SEC * dt * 2) / 1000, 6);
  });

  it("드리프트는 distance를 변화시키지 않는다", () => {
    const dt = 400;
    const tapped = applyTap(freshState(1), "L", 0);

    const drifted = applyDrift(tapped, dt, DRIFT_GRACE_MS * 2 + dt);

    expect(drifted.distance).toBe(tapped.distance);
    expect(drifted.distanceReachedAt).toBe(tapped.distanceReachedAt);
  });

  it("applyDrift는 입력 상태를 변경하지 않는 순수 함수다", () => {
    const state = applyTap(freshState(1), "L", 0);
    const before = structuredClone(state);

    const next = applyDrift(state, 400, DRIFT_GRACE_MS * 2 + 400);

    expect(state).toEqual(before);
    expect(next).not.toBe(state);
  });
});

describe("넘어짐 판정 (FR-011 / US2-AS4)", () => {
  it("같은 쪽 연속 탭으로 abs(tilt)가 TILT_LIMIT에 도달하면 fallen이 true가 되고 finishedAt이 그 시점으로 확정된다", () => {
    const step = MIN_TAP_INTERVAL_MS * 2;
    const tapsToFall = 1 + Math.ceil(TILT_LIMIT / TILT_PENALTY_SAME_SIDE);
    const fallenAt = (tapsToFall - 1) * step;

    const state = tapSameSideTimes("L", tapsToFall);

    expect(Math.abs(state.tilt)).toBeGreaterThanOrEqual(TILT_LIMIT);
    expect(state.fallen).toBe(true);
    expect(state.finishedAt).toBe(fallenAt);
  });

  it("한계에 도달하기 직전까지는 넘어지지 않는다", () => {
    const tapsBeforeFall = Math.ceil(TILT_LIMIT / TILT_PENALTY_SAME_SIDE);

    const state = tapSameSideTimes("L", tapsBeforeFall);

    expect(Math.abs(state.tilt)).toBeLessThan(TILT_LIMIT);
    expect(state.fallen).toBe(false);
    expect(state.finishedAt).toBeNull();
  });

  it("드리프트로 abs(tilt)가 TILT_LIMIT에 도달하면 fallen이 true가 되고 finishedAt이 그 시점으로 확정된다", () => {
    const dt = (TILT_LIMIT / DRIFT_PER_SEC) * 1000;
    const now = DRIFT_GRACE_MS * 2 + dt;
    const tapped = applyTap(freshState(1), "L", 0);

    const state = applyDrift(tapped, dt, now);

    expect(Math.abs(state.tilt)).toBeGreaterThanOrEqual(TILT_LIMIT);
    expect(state.fallen).toBe(true);
    expect(state.finishedAt).toBe(now);
  });

  it("넘어진 뒤에는 applyTap이 상태를 바꾸지 않는다", () => {
    const step = MIN_TAP_INTERVAL_MS * 2;
    const tapsToFall = 1 + Math.ceil(TILT_LIMIT / TILT_PENALTY_SAME_SIDE);
    const fallen = tapSameSideTimes("L", tapsToFall);

    const afterTap = applyTap(fallen, "R", tapsToFall * step);

    expect(afterTap).toEqual(fallen);
  });

  it("넘어진 뒤에는 applyDrift가 상태를 바꾸지 않는다", () => {
    const tapsToFall = 1 + Math.ceil(TILT_LIMIT / TILT_PENALTY_SAME_SIDE);
    const fallen = tapSameSideTimes("L", tapsToFall);

    const afterDrift = applyDrift(fallen, 1_000, DRIFT_GRACE_MS * 10);

    expect(afterDrift).toEqual(fallen);
  });
});

describe("기울기·거리 불변식 (data-model.md §PlayerRaceState)", () => {
  it("tilt는 클램프하지 않고 원시값을 유지한다 (TILT_LIMIT를 넘는 값이 그대로 남는다)", () => {
    const tapsToFall = 1 + Math.ceil(TILT_LIMIT / TILT_PENALTY_SAME_SIDE);
    const penaltyCount = tapsToFall - 1;

    const state = tapSameSideTimes("L", tapsToFall);

    expect(Math.abs(state.tilt)).toBe(TILT_PENALTY_SAME_SIDE * penaltyCount);
    expect(Math.abs(state.tilt)).toBeGreaterThan(TILT_LIMIT);
  });

  it("distance는 어떤 입력 조합에서도 감소하지 않는다 (단조 증가)", () => {
    const step = MIN_TAP_INTERVAL_MS * 2;
    const script: Array<{ kind: "tap"; side: "L" | "R" } | { kind: "drift"; dt: number }> = [
      { kind: "tap", side: "L" },
      { kind: "tap", side: "R" },
      { kind: "tap", side: "R" },
      { kind: "drift", dt: 300 },
      { kind: "tap", side: "L" },
      { kind: "drift", dt: 1_000 },
      { kind: "tap", side: "L" },
      { kind: "tap", side: "L" },
      { kind: "drift", dt: 2_000 },
      { kind: "tap", side: "R" },
    ];

    let state = freshState(1);
    let now = 0;
    let previousDistance = state.distance;

    for (const action of script) {
      if (action.kind === "tap") {
        now += step;
        state = applyTap(state, action.side, now);
      } else {
        now += action.dt;
        state = applyDrift(state, action.dt, now);
      }
      expect(state.distance).toBeGreaterThanOrEqual(previousDistance);
      previousDistance = state.distance;
    }
  });

  it("무시된 연타 이후에도 distance와 distanceReachedAt이 되돌아가지 않는다", () => {
    const advanced = applyTap(applyTap(freshState(), "L", 0), "R", MIN_TAP_INTERVAL_MS * 2);

    const afterBurst = applyTap(advanced, "L", MIN_TAP_INTERVAL_MS * 2 + 1);

    expect(afterBurst.distance).toBeGreaterThanOrEqual(advanced.distance);
    expect(afterBurst.distanceReachedAt).toBe(advanced.distanceReachedAt);
  });
});

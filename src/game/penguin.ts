// 펭귄 빙판 걷기 판정 순수 로직 — UI·전송 무의존.
// 규칙 근거: specs/001-penguin-party/spec.md FR-008~012, data-model.md PlayerRaceState.
// 모든 시각(now)은 레이스 시작 기준 경과 ms.

import {
  DRIFT_GRACE_MS,
  DRIFT_PER_SEC,
  MIN_TAP_INTERVAL_MS,
  STEP_DISTANCE,
  TILT_LIMIT,
  TILT_PENALTY_SAME_SIDE,
  TILT_RECOVER_PER_STEP,
} from "@/src/game/balance";
import type { TSide } from "@/src/p2p/protocol";

export interface TPenguinRaceState {
  distance: number;
  tilt: number; // 원시값 — 클램프하지 않음. 표시용 클램프는 UI 소관
  fallen: boolean;
  distanceReachedAt: number | null;
  finishedAt: number | null;
  seq: number;
  lastSide: TSide | null;
  lastTapAt: number | null;
  driftDirection: 1 | -1;
}

export interface TCreateRaceStateOptions {
  driftDirection?: 1 | -1;
}

export const createRaceState = (
  options: TCreateRaceStateOptions = {},
): TPenguinRaceState => ({
  distance: 0,
  tilt: 0,
  fallen: false,
  distanceReachedAt: null,
  finishedAt: null,
  seq: 0,
  lastSide: null,
  lastTapAt: null,
  driftDirection: options.driftDirection ?? (Math.random() < 0.5 ? -1 : 1),
});

const sideDirection = (side: TSide): 1 | -1 => (side === "R" ? 1 : -1);

const withFallCheck = (
  state: TPenguinRaceState,
  now: number,
): TPenguinRaceState =>
  Math.abs(state.tilt) >= TILT_LIMIT
    ? { ...state, fallen: true, finishedAt: now }
    : state;

export const applyTap = (
  state: TPenguinRaceState,
  side: TSide,
  now: number,
): TPenguinRaceState => {
  if (state.fallen) return state;
  if (state.lastTapAt !== null && now - state.lastTapAt < MIN_TAP_INTERVAL_MS) {
    return state;
  }

  if (state.lastSide === side) {
    const tilt = state.tilt + sideDirection(side) * TILT_PENALTY_SAME_SIDE;
    return withFallCheck({ ...state, tilt, lastSide: side, lastTapAt: now }, now);
  }

  const recovered =
    state.tilt > 0
      ? Math.max(0, state.tilt - TILT_RECOVER_PER_STEP)
      : Math.min(0, state.tilt + TILT_RECOVER_PER_STEP);

  return withFallCheck(
    {
      ...state,
      distance: state.distance + STEP_DISTANCE,
      tilt: recovered,
      distanceReachedAt: now,
      lastSide: side,
      lastTapAt: now,
    },
    now,
  );
};

export const applyDrift = (
  state: TPenguinRaceState,
  dt: number,
  now: number,
): TPenguinRaceState => {
  if (state.fallen) return state;
  const reference = state.lastTapAt ?? 0;
  if (now - reference <= DRIFT_GRACE_MS) return state;

  const tilt = state.tilt + state.driftDirection * DRIFT_PER_SEC * (dt / 1000);
  return withFallCheck({ ...state, tilt }, now);
};

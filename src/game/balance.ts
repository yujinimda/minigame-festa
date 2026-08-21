// 밸런스 상수 단일 출처 — specs/001-penguin-party/data-model.md §밸런스 상수와 1:1.
// 스펙 고정값(FR): TILT_LIMIT ±100, RACE_DURATION 30s, MAX_PLAYERS 15.
// 나머지는 플레이테스트로 조정 가능하되 이 파일과 data-model.md에서만 바꾼다.

export const RACE_DURATION_MS = 30_000;
export const TILT_LIMIT = 100;
export const STEP_DISTANCE = 1;
export const TILT_RECOVER_PER_STEP = 8;
export const TILT_PENALTY_SAME_SIDE = 35;
export const DRIFT_PER_SEC = 25;
export const DRIFT_GRACE_MS = 700;
export const MIN_TAP_INTERVAL_MS = 60;
export const STATE_SEND_HZ = 10;
export const MAX_PLAYERS = 15;
export const MIN_PLAYERS = 2; // FR-006 시작 최소 인원
export const COUNTDOWN_MS = 3_000;

export const HEARTBEAT_INTERVAL_MS = 2_000;
export const HEARTBEAT_TIMEOUT_MS = 6_000;
export const ROOM_CLOSED_TIMEOUT_MS = 20_000;
export const CONNECT_TIMEOUT_MS = 10_000;
export const RECONNECT_BACKOFF_MS = [1_000, 2_000, 4_000, 10_000] as const;
export const NICKNAME_MAX_LENGTH = 10;
export const BUFFERED_AMOUNT_LIMIT = 16 * 1024;

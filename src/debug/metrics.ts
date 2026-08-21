// SC-002 계측 모드(?debug=1) — quickstart §플레이테스트 게이트의 측정 전제.
// 이벤트를 window.__mgfDebug 링버퍼에 쌓고, 콘솔에서 __mgfDebugDump()로 내려받는다.
// 시계 오프셋: heartbeat-ack의 (t 에코, hostT 벽시계)로 offset = hostT - (t + rtt/2).
"use client";

export interface TDebugEvent {
  at: number; // Date.now()
  kind: "tap" | "state-send" | "state-recv" | "render" | "clock";
  detail: Record<string, number | string | null>;
}

const MAX_EVENTS = 5000;

interface TDebugGlobal {
  __mgfDebug?: TDebugEvent[];
  __mgfDebugDump?: () => TDebugEvent[];
}

export const isDebugMode = (): boolean =>
  typeof location !== "undefined" &&
  new URLSearchParams(location.search).has("debug");

export const logDebug = (
  kind: TDebugEvent["kind"],
  detail: TDebugEvent["detail"],
): void => {
  if (!isDebugMode()) return;
  const g = globalThis as TDebugGlobal;
  g.__mgfDebug ??= [];
  g.__mgfDebugDump ??= () => g.__mgfDebug ?? [];
  g.__mgfDebug.push({ at: Date.now(), kind, detail });
  if (g.__mgfDebug.length > MAX_EVENTS) g.__mgfDebug.splice(0, 1000);
};

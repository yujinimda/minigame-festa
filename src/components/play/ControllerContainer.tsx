"use client";

// US2 — 컨트롤러: 좌/우 탭 → 로컬 판정(FR-013) → 호스트 전송. 넘어짐 피드백(FR-011·025)

import { useEffect, useRef, useState } from "react";
import Controller from "@/src/components/play/Controller";
import TiltGauge from "@/src/components/play/TiltGauge";
import { playSfx, vibrate } from "@/src/audio/sound";
import { logDebug } from "@/src/debug/metrics";
import type { TPlayerSession } from "@/src/components/shared/usePlayerSession";
import { applyDrift, applyTap, createRaceState, type TPenguinRaceState } from "@/src/game/penguin";
import type { TPlayerStatus, TPlayerClientHandle } from "@/src/p2p/player-client";
import type { TSide } from "@/src/p2p/protocol";
import { usePlayerStore } from "@/src/stores/player-store";

export interface TPlayControllerContainerProps {
  session: TPlayerSession;
}

const DRIFT_TICK_MS = 50;

const toPayload = (state: TPenguinRaceState) => ({
  distance: state.distance,
  tilt: state.tilt,
  fallen: state.fallen,
  distanceReachedAt: state.distanceReachedAt,
});

// 판정 상태를 소유하는 내부 컴포넌트 — 레이스 세대(key)마다 리마운트되어 초기화된다
const RaceRunner = ({
  status,
  nickname,
  client,
}: {
  status: TPlayerStatus;
  nickname: string | null;
  client: TPlayerClientHandle | null;
}) => {
  const stateRef = useRef<TPenguinRaceState>(createRaceState());
  const fallReportedRef = useRef(false);
  const [display, setDisplay] = useState({ distance: 0, tilt: 0, fallen: false });
  const [flash, setFlash] = useState(false);
  const [startBanner, setStartBanner] = useState(false);

  // 레이스 시작 피드백(FR-025, 게이트8 US2-B1): **countdown→racing 전환에서만** 발화 —
  // reconnecting→racing 복귀나 레이스 중 재합류에 "출발!!"이 재발화하지 않게(2회차 NOTE).
  // 전환 감지는 렌더 중 상태 보정 패턴(이펙트 내 동기 setState 금지)
  const [prevRunStatus, setPrevRunStatus] = useState(status);
  if (prevRunStatus !== status) {
    setPrevRunStatus(status);
    if (status === "racing" && prevRunStatus === "countdown") setStartBanner(true);
  }

  // 사운드·진동은 배너 발화에 종속 — 전환 1회당 1회, StrictMode 마운트 경로 중복 없음
  useEffect(() => {
    if (!startBanner) return;
    playSfx("start");
    vibrate(80); // iOS 미지원 시 배너가 시각 폴백
    const timer = setTimeout(() => setStartBanner(false), 1200);
    return () => clearTimeout(timer);
  }, [startBanner]);

  const raceNow = (): number => client?.core.raceElapsed() ?? 0;

  const handleFallen = (state: TPenguinRaceState) => {
    if (fallReportedRef.current) return;
    fallReportedRef.current = true;
    client?.reportFall(toPayload(state));
    playSfx("fall");
    if (!vibrate([120, 60, 120])) {
      // iOS Safari 진동 폴백 — 시각 플래시(FR-025)
      setFlash(true);
      setTimeout(() => setFlash(false), 350);
    }
  };

  const commit = (next: TPenguinRaceState) => {
    stateRef.current = next;
    setDisplay({ distance: next.distance, tilt: next.tilt, fallen: next.fallen });
    if (next.fallen) handleFallen(next);
    else client?.pushState(toPayload(next));
  };

  const handleTap = (side: TSide) => {
    if (status !== "racing" || stateRef.current.fallen) return;
    const next = applyTap(stateRef.current, side, raceNow());
    if (next === stateRef.current) return; // 연타 무시(MIN_TAP_INTERVAL)
    logDebug("tap", { side, distance: next.distance }); // 계측 모드(SC-002)
    if (!next.fallen) {
      playSfx("tap");
      vibrate(12);
    }
    commit(next);
  };

  // 드리프트 루프 — 판정은 폰 로컬(FR-010·013)
  useEffect(() => {
    if (status !== "racing") return;
    let last = client?.core.raceElapsed() ?? 0;
    const timer = setInterval(() => {
      if (stateRef.current.fallen) return;
      const now = client?.core.raceElapsed() ?? 0;
      const next = applyDrift(stateRef.current, now - last, now);
      last = now;
      if (next !== stateRef.current) {
        stateRef.current = next;
        setDisplay({ distance: next.distance, tilt: next.tilt, fallen: next.fallen });
        if (next.fallen) handleFallen(next);
        else client?.pushState(toPayload(next));
      }
    }, DRIFT_TICK_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, client]);

  const waiting = status === "idle" || status === "joined";
  const finishedByFall = display.fallen;
  const finishedClean = status === "finished" && !finishedByFall;

  return (
    <main
      className={`flex min-h-dvh flex-col gap-4 p-4 text-white transition-colors ${
        flash ? "bg-rose-600" : "bg-sky-950"
      }`}
    >
      <header className="flex items-center justify-between">
        <span className="font-bold">🐧 {nickname ?? ""}</span>
        <span className="font-mono text-lg">{display.distance}보</span>
      </header>

      <TiltGauge tilt={display.tilt} />

      {status === "countdown" && (
        <p className="rounded-2xl bg-amber-400/90 px-4 py-3 text-center text-xl font-black text-sky-950">
          왼발 오른발 번갈아 탭! 같은 발 두 번이면 미끄러져요 🧊
        </p>
      )}
      {startBanner && (
        <p className="rounded-2xl bg-emerald-400 px-4 py-3 text-center text-2xl font-black text-sky-950">
          출발!! 🏃💨
        </p>
      )}
      {status === "reconnecting" && (
        <p role="status" className="text-center text-sky-300">
          연결이 불안정해요 — 다시 연결 중…
        </p>
      )}
      {waiting && (
        <p className="text-center text-sky-300">호스트가 시작하면 게임이 열려요 — 큰 화면을 보세요!</p>
      )}

      {finishedByFall && (
        <p className="rounded-2xl bg-rose-500/30 px-4 py-4 text-center text-2xl font-black">
          꽈당! 🧊 {display.distance}보에서 넘어졌어요
        </p>
      )}
      {finishedClean && (
        <p className="rounded-2xl bg-sky-800 px-4 py-4 text-center text-xl font-bold">
          🏁 {display.distance}보 완주! 결과 대기 중…
        </p>
      )}

      <Controller disabled={status !== "racing" || display.fallen} onTap={handleTap} />
    </main>
  );
};

const PlayControllerContainer = ({ session }: TPlayControllerContainerProps) => {
  const status = usePlayerStore((s) => s.status);
  const nickname = usePlayerStore((s) => s.nickname);

  // 레이스 세대: 새 판 진입마다 증가 → RaceRunner 리마운트로 판정 상태 초기화.
  // countdown 진입 외에, 대기 상태에서 곧장 racing으로 합류하는 재접속(다음 판이
  // 이미 진행 중)도 새 판이다 — 이전 판 stateRef 승계 방지(2회차 NOTE).
  // reconnecting→racing 복귀는 같은 판이므로 리마운트하지 않는다
  const [raceGen, setRaceGen] = useState(0);
  const [prevStatus, setPrevStatus] = useState(status);
  if (prevStatus !== status) {
    setPrevStatus(status);
    const freshEntry = prevStatus === "idle" || prevStatus === "joined";
    if (status === "countdown" || (status === "racing" && freshEntry)) {
      setRaceGen((g) => g + 1);
    }
  }

  return (
    <RaceRunner key={raceGen} status={status} nickname={nickname} client={session.client} />
  );
};

export default PlayControllerContainer;

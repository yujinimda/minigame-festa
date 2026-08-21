"use client";

// US2 — 호스트 레이스 뷰: Phaser 게임 마운트/언마운트.
// phaser는 여기서만 동적 import — 폰·초기 번들에 미포함(R6)

import { useEffect, useRef } from "react";
import type { THostRoomHandle } from "@/src/p2p/host-room";

// Phaser 청크 프리페치 — 호스트 페이지 로드 시점에 받아두지 않으면 3초 카운트다운보다
// 늦게 도착해 3·2·1을 건너뛸 수 있다(게이트8 US2 NOTE)
if (typeof window !== "undefined") {
  void import("@/src/game-view/race-scene");
}

export interface THostRaceContainerProps {
  room: THostRoomHandle | null;
}

const HostRaceContainer = ({ room }: THostRaceContainerProps) => {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!room || !mountRef.current) return;
    const parent = mountRef.current;
    let cancelled = false;
    let handle: { destroy: () => void } | null = null;

    void import("@/src/game-view/race-scene").then(({ buildRaceGame }) => {
      if (cancelled) return;
      handle = buildRaceGame(parent, {
        getPositions: () => room.core.getRacePositions(),
        getCountdownRemainingMs: () => room.core.countdownRemainingMs(),
        getRaceRemainingMs: () => room.core.raceRemainingMs(),
      });
    });

    return () => {
      cancelled = true;
      handle?.destroy();
    };
  }, [room]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-sky-950">
      <div ref={mountRef} className="h-dvh w-full" aria-label="레이스 트랙" />
    </main>
  );
};

export default HostRaceContainer;

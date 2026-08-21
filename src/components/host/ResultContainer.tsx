"use client";

// US3 — 호스트 순위 발표 + 다시 하기 (FR-015·016·017·024)

import { useEffect } from "react";
import RankingBoard from "@/src/components/host/RankingBoard";
import { playSfx, stopBgm } from "@/src/audio/sound";
import type { THostRoomHandle } from "@/src/p2p/host-room";
import { useHostStore } from "@/src/stores/host-store";

export interface THostResultContainerProps {
  room: THostRoomHandle | null;
}

const HostResultContainer = ({ room }: THostResultContainerProps) => {
  const results = useHostStore((s) => s.results);

  // 결과 발표 사운드 — BGM 정리 후 팡파레(FR-024)
  useEffect(() => {
    stopBgm();
    playSfx("result");
  }, []);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-sky-950 p-8 text-white">
      <h1 className="text-4xl font-black">🏆 최종 순위</h1>
      {results && results.length > 0 ? (
        <RankingBoard results={results} />
      ) : (
        <p className="text-sky-300">집계 중…</p>
      )}
      <button
        type="button"
        onClick={() => room?.core.returnLobby()}
        className="rounded-2xl bg-amber-400 px-12 py-5 text-2xl font-black text-sky-950 transition hover:scale-105 active:scale-95"
      >
        같은 멤버로 다시 하기 🔄
      </button>
    </main>
  );
};

export default HostResultContainer;

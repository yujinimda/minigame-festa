"use client";

// US3 — 폰 개인 결과: 내 등수·거리 강조, 집계 전엔 대기 안내 (FR-015·016)

import type { TPlayerSession } from "@/src/components/shared/usePlayerSession";
import { usePlayerStore } from "@/src/stores/player-store";

export interface TPersonalResultContainerProps {
  session: TPlayerSession;
}

const PersonalResultContainer = ({ session }: TPersonalResultContainerProps) => {
  const nickname = usePlayerStore((s) => s.nickname);
  const results = usePlayerStore((s) => s.results);
  void session; // 현재 표시용 데이터는 전부 스토어 미러에 있음

  const mine = results?.find((r) => r.nickname === nickname) ?? null;

  if (!mine) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-sky-950 p-6 text-center text-white">
        <p className="text-6xl">🐧</p>
        <h1 className="text-2xl font-bold">기록 확정!</h1>
        <p className="text-sky-300">다른 펭귄들이 달리는 중 — 결과 대기 중이에요. 큰 화면을 보세요!</p>
      </main>
    );
  }

  const isWinner = mine.rank === 1;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-sky-950 p-6 text-center text-white">
      <p className="text-7xl">{isWinner ? "👑" : mine.fallen ? "💥" : "🐧"}</p>
      <h1 data-testid="my-rank" className={`text-6xl font-black ${isWinner ? "text-amber-300" : ""}`}>
        {mine.rank}위
      </h1>
      <p className="text-2xl font-bold">
        {nickname} — <span className="font-mono">{mine.distance}보</span>
      </p>
      {mine.fallen && (
        <p className="rounded-xl bg-rose-500/20 px-4 py-2 font-semibold text-rose-200">
          꽈당! 빙판에 미끄러졌어요 🧊
        </p>
      )}
      <p className="text-sky-300">호스트가 다시 하기를 누르면 새 판이 시작돼요</p>
    </main>
  );
};

export default PersonalResultContainer;

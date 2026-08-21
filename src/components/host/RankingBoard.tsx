"use client";

// 순위 보드 — rank 기준 정렬 렌더, 1등 강조, 넘어짐 표기 (FR-015·016)

import type { TRaceResult } from "@/src/p2p/protocol";

interface TRankingBoardProps {
  results: TRaceResult[];
}

const MEDALS: Record<number, string> = { 1: "👑", 2: "🥈", 3: "🥉" };

const RankingBoard = ({ results }: TRankingBoardProps) => {
  const sorted = [...results].sort((a, b) => a.rank - b.rank);

  return (
    <ol className="flex w-full max-w-2xl flex-col gap-3">
      {sorted.map((result) => (
        <li
          key={result.playerId}
          data-testid={`rank-${result.rank}`}
          className={`flex items-center gap-4 rounded-2xl px-6 py-4 text-xl font-bold ${
            result.rank === 1
              ? "scale-105 bg-amber-400 text-sky-950 shadow-lg"
              : "bg-sky-800 text-white"
          }`}
        >
          <span className="w-24 shrink-0 text-2xl font-black tabular-nums">
            {MEDALS[result.rank] ?? ""} {result.rank}위
          </span>
          <span className="min-w-0 flex-1 truncate">🐧 {result.nickname}</span>
          {result.fallen && (
            <span className="shrink-0 text-base font-semibold opacity-80">꽈당 💥</span>
          )}
          <span className="shrink-0 font-mono tabular-nums">{result.distance}보</span>
        </li>
      ))}
    </ol>
  );
};

export default RankingBoard;

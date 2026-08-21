"use client";

// 로비 참가자 목록 — 닉네임·연결 상태 실시간 표시 (FR-005)

import { MAX_PLAYERS } from "@/src/game/balance";
import type { TRosterEntry } from "@/src/p2p/protocol";

interface TLobbyListProps {
  roster: TRosterEntry[];
}

const PENGUIN_EMOJI = ["🐧", "🐤", "🦆", "🕊️", "🦉"];

const LobbyList = ({ roster }: TLobbyListProps) => (
  <div className="flex w-full max-w-2xl flex-col gap-3">
    <h2 className="text-xl font-bold text-sky-200">
      참가자 {roster.length} / {MAX_PLAYERS}
    </h2>
    <ul className="grid grid-cols-3 gap-3">
      {roster.map((player, index) => (
        <li
          key={player.playerId}
          className={`flex items-center gap-2 rounded-2xl px-4 py-3 text-lg font-bold ${
            player.connected
              ? "bg-sky-800 text-white"
              : "bg-sky-900/50 text-sky-500"
          }`}
        >
          <span aria-hidden>{PENGUIN_EMOJI[index % PENGUIN_EMOJI.length]}</span>
          <span className="truncate">{player.nickname}</span>
          {!player.connected && (
            <span className="ml-auto shrink-0 text-xs font-semibold text-rose-300">
              끊김
            </span>
          )}
        </li>
      ))}
      {roster.length === 0 && (
        <li className="col-span-3 rounded-2xl bg-sky-900/50 px-4 py-6 text-center text-sky-400">
          아직 아무도 없어요 — QR을 찍어 들어오세요!
        </li>
      )}
    </ul>
  </div>
);

export default LobbyList;

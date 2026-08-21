"use client";

// US1 — 호스트 로비: QR + 참가자 목록 + 시작 버튼 (FR-001·005·006)

import LobbyList from "@/src/components/host/LobbyList";
import QrPanel from "@/src/components/host/QrPanel";
import { unlockAudio } from "@/src/audio/sound";
import { MIN_PLAYERS } from "@/src/game/balance";
import type { THostRoomHandle } from "@/src/p2p/host-room";
import { useHostStore } from "@/src/stores/host-store";

export interface THostLobbyContainerProps {
  room: THostRoomHandle | null;
}

const HostLobbyContainer = ({ room }: THostLobbyContainerProps) => {
  const roomId = useHostStore((s) => s.roomId);
  const roster = useHostStore((s) => s.roster);
  const canStart = roster.length >= MIN_PLAYERS;

  const handleStart = async () => {
    // 호스트 오디오 언락 지점 — 사용자 제스처(FR-024)
    await unlockAudio();
    room?.core.startRace();
  };

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-sky-950 p-8 text-white">
      <h1 className="text-4xl font-black">🐧 펭귄 빙판 걷기</h1>
      {roomId && <QrPanel roomId={roomId} />}
      <LobbyList roster={roster} />
      <button
        type="button"
        disabled={!canStart}
        onClick={handleStart}
        className="rounded-2xl bg-amber-400 px-12 py-5 text-2xl font-black text-sky-950 transition enabled:hover:scale-105 enabled:active:scale-95 disabled:opacity-40"
      >
        {canStart ? "게임 시작!" : `시작하려면 ${MIN_PLAYERS}명 이상 필요`}
      </button>
    </main>
  );
};

export default HostLobbyContainer;

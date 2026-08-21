"use client";

// 호스트 셸 — phase 스위치만 담당. 내용은 각 스토리 소유 컨테이너가 구현(F 이후 불변).

import HostLobbyContainer from "@/src/components/host/LobbyContainer";
import HostRaceContainer from "@/src/components/host/RaceContainer";
import HostResultContainer from "@/src/components/host/ResultContainer";
import { useHostRoom } from "@/src/components/shared/useHostRoom";
import { useHostStore } from "@/src/stores/host-store";

export default function HostPage() {
  const room = useHostRoom();
  const { status, phase, errorMessage } = useHostStore();

  if (status === "error") {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-sky-950 p-8 text-white">
        <p className="text-xl">방을 열지 못했어요: {errorMessage} — 새로고침으로 다시 시도</p>
      </main>
    );
  }
  if (status === "opening") {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-sky-950 p-8 text-white">
        <p className="animate-pulse text-2xl">방 여는 중…</p>
      </main>
    );
  }

  if (phase === "lobby") return <HostLobbyContainer room={room} />;
  if (phase === "countdown" || phase === "race") return <HostRaceContainer room={room} />;
  return <HostResultContainer room={room} />;
}

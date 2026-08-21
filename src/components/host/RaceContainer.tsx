"use client";

// US2 소유 — Phaser 레이스 뷰 마운트. 현재는 F가 만든 스텁.

import type { THostRoomHandle } from "@/src/p2p/host-room";

export interface THostRaceContainerProps {
  room: THostRoomHandle | null;
}

const HostRaceContainer = (_props: THostRaceContainerProps) => {
  void _props; // 스텁 — 스토리 구현에서 사용
  return (
  <main className="flex min-h-dvh items-center justify-center bg-sky-950 text-white">
    <p>레이스 (US2에서 구현)</p>
  </main>
  );
};

export default HostRaceContainer;

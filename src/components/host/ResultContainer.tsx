"use client";

// US3 소유 — 순위 발표 + 다시 하기. 현재는 F가 만든 스텁.

import type { THostRoomHandle } from "@/src/p2p/host-room";

export interface THostResultContainerProps {
  room: THostRoomHandle | null;
}

const HostResultContainer = (_props: THostResultContainerProps) => {
  void _props; // 스텁 — 스토리 구현에서 사용
  return (
  <main className="flex min-h-dvh items-center justify-center bg-sky-950 text-white">
    <p>결과 (US3에서 구현)</p>
  </main>
  );
};

export default HostResultContainer;

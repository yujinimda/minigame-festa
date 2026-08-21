"use client";

// US1 소유 — QR 패널 + 로비 목록 + 시작 버튼. 현재는 F가 만든 스텁.

import type { THostRoomHandle } from "@/src/p2p/host-room";

export interface THostLobbyContainerProps {
  room: THostRoomHandle | null;
}

const HostLobbyContainer = (_props: THostLobbyContainerProps) => {
  void _props; // 스텁 — 스토리 구현에서 사용
  return (
  <main className="flex min-h-dvh items-center justify-center bg-sky-950 text-white">
    <p>로비 (US1에서 구현)</p>
  </main>
  );
};

export default HostLobbyContainer;

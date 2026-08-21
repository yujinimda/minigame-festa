"use client";

// US2 소유 — 좌/우 컨트롤러 + 기울기 게이지 + 게임 루프. 현재는 F가 만든 스텁.

import type { TPlayerSession } from "@/src/components/shared/usePlayerSession";

export interface TPlayControllerContainerProps {
  session: TPlayerSession;
}

const PlayControllerContainer = (_props: TPlayControllerContainerProps) => {
  void _props; // 스텁 — 스토리 구현에서 사용
  return (
  <main className="flex min-h-dvh items-center justify-center bg-sky-950 text-white">
    <p>컨트롤러 (US2에서 구현)</p>
  </main>
  );
};

export default PlayControllerContainer;

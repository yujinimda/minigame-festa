"use client";

// US3 소유 — 개인 기록·등수·대기 안내. 현재는 F가 만든 스텁.

import type { TPlayerSession } from "@/src/components/shared/usePlayerSession";

export interface TPersonalResultContainerProps {
  session: TPlayerSession;
}

const PersonalResultContainer = (_props: TPersonalResultContainerProps) => {
  void _props; // 스텁 — 스토리 구현에서 사용
  return (
  <main className="flex min-h-dvh items-center justify-center bg-sky-950 text-white">
    <p>개인 결과 (US3에서 구현)</p>
  </main>
  );
};

export default PersonalResultContainer;

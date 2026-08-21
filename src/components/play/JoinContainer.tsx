"use client";

// US1 소유 — 닉네임 입력·거부 안내·재시도. 현재는 F가 만든 스텁.

export interface TPlayJoinContainerProps {
  roomId: string;
  rejectReason: string | null;
  connectFailed: boolean;
  onJoin: (nickname: string) => void;
}

const PlayJoinContainer = (_props: TPlayJoinContainerProps) => {
  void _props; // 스텁 — 스토리 구현에서 사용
  return (
  <main className="flex min-h-dvh items-center justify-center bg-sky-950 text-white">
    <p>닉네임 입력 (US1에서 구현)</p>
  </main>
  );
};

export default PlayJoinContainer;

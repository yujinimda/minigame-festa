"use client";

// FR-025: 오디오 언락 실패 시 음소거 상태 표시(F 소유 공용 컴포넌트)

import { usePlayerStore } from "@/src/stores/player-store";

const MuteBadge = () => {
  const muted = usePlayerStore((s) => s.muted);
  if (!muted) return null;
  return (
    <div
      role="status"
      className="fixed right-3 top-3 rounded-full bg-black/60 px-3 py-1 text-sm text-white"
    >
      🔇 소리 꺼짐
    </div>
  );
};

export default MuteBadge;

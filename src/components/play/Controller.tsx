"use client";

// 좌/우 발 버튼 — 입력은 pointerdown(터치·마우스·테스트 공통, 탭 지연 없음)

import type { TSide } from "@/src/p2p/protocol";

interface TControllerProps {
  disabled: boolean;
  onTap: (side: TSide) => void;
}

const Controller = ({ disabled, onTap }: TControllerProps) => (
  <div className="flex w-full flex-1 gap-4">
    <button
      type="button"
      aria-label="왼발"
      disabled={disabled}
      onPointerDown={() => onTap("L")}
      className="flex-1 select-none rounded-3xl bg-sky-600 text-6xl font-black text-white transition enabled:active:scale-95 enabled:active:bg-sky-500 disabled:opacity-40"
    >
      🦶
      <span className="mt-2 block text-2xl">왼발</span>
    </button>
    <button
      type="button"
      aria-label="오른발"
      disabled={disabled}
      onPointerDown={() => onTap("R")}
      className="flex-1 select-none rounded-3xl bg-amber-500 text-6xl font-black text-white transition enabled:active:scale-95 enabled:active:bg-amber-400 disabled:opacity-40"
    >
      🦶
      <span className="mt-2 block text-2xl">오른발</span>
    </button>
  </div>
);

export default Controller;

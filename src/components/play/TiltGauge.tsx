"use client";

// 기울기 게이지 — 원시 tilt를 표시용으로만 ±TILT_LIMIT 클램프(data-model §PlayerRaceState)

import { TILT_LIMIT } from "@/src/game/balance";

interface TTiltGaugeProps {
  tilt: number;
}

const TiltGauge = ({ tilt }: TTiltGaugeProps) => {
  const clamped = Math.max(-TILT_LIMIT, Math.min(TILT_LIMIT, tilt));
  const percent = ((clamped + TILT_LIMIT) / (TILT_LIMIT * 2)) * 100;
  const danger = Math.abs(clamped) > TILT_LIMIT * 0.6;

  return (
    <div
      role="progressbar"
      aria-label="기울기"
      aria-valuenow={clamped}
      // eslint-disable-next-line jsx-a11y/aria-proptypes -- 단항 마이너스 상수를 플러그인이 정적 해석 못함(값은 숫자)
      aria-valuemin={-TILT_LIMIT}
      aria-valuemax={TILT_LIMIT}
      className="relative h-6 w-full max-w-sm overflow-hidden rounded-full bg-sky-900"
    >
      {/* 중앙 기준선 */}
      <div className="absolute left-1/2 top-0 h-full w-0.5 bg-sky-600" />
      {/* 기울기 마커 */}
      <div
        className={`absolute top-0.5 size-5 rounded-full transition-[left] duration-75 ${
          danger ? "bg-rose-400" : "bg-amber-300"
        }`}
        style={{ left: `calc(${percent}% - 10px)` }}
      />
    </div>
  );
};

export default TiltGauge;

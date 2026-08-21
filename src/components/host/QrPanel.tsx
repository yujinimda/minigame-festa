"use client";

// 참가 QR + 방 코드 (FR-001). URL은 정적 라우팅 결정(/play?room=)과 동일 — research R2·R7

import { QRCodeSVG } from "qrcode.react";
import { useSyncExternalStore } from "react";

interface TQrPanelProps {
  roomId: string;
}

// origin은 클라이언트에서만 존재 — SSR/프리렌더 스냅샷은 null(하이드레이션 불일치 방지)
const subscribeNoop = () => () => {};
const useOrigin = (): string | null =>
  useSyncExternalStore(
    subscribeNoop,
    () => window.location.origin,
    () => null,
  );

const QrPanel = ({ roomId }: TQrPanelProps) => {
  const origin = useOrigin();
  const joinUrl = origin ? `${origin}/play?room=${roomId}` : null;

  return (
    <div className="flex flex-col items-center gap-4 rounded-3xl bg-white p-6 text-sky-950">
      {joinUrl ? (
        <QRCodeSVG value={joinUrl} size={220} aria-label="참가 QR 코드" />
      ) : (
        <div className="size-[220px] animate-pulse rounded-xl bg-sky-100" />
      )}
      <p className="text-lg font-bold">
        📱 폰으로 QR을 찍어 입장하세요
      </p>
      <p className="text-sm text-sky-600">
        방 코드: <span className="font-mono text-xl font-black tracking-widest">{roomId}</span>
      </p>
    </div>
  );
};

export default QrPanel;

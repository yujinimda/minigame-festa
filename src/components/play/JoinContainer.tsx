"use client";

// US1 — 참가 화면: 닉네임 입력 → 입장, 거부/실패 사유 안내 (FR-002·003·004·020)

import { useState } from "react";
import NicknameForm from "@/src/components/play/NicknameForm";
import { loadIdentity } from "@/src/p2p/player-client";

export interface TPlayJoinContainerProps {
  roomId: string;
  rejectReason: string | null;
  connectFailed: boolean;
  onJoin: (nickname: string) => void;
}

const REJECT_MESSAGES: Record<string, string> = {
  "room-full": "정원이 가득 찼어요 (최대 15명)",
  "race-in-progress": "게임이 진행 중이에요 — 다음 판을 기다려주세요",
  "invalid-nickname": "닉네임이 올바르지 않아요 — 다시 입력해주세요",
};

const PlayJoinContainer = ({
  roomId,
  rejectReason,
  connectFailed,
  onJoin,
}: TPlayJoinContainerProps) => {
  // loadIdentity는 렌더마다 호출해도 같은 값이지만, 프리필 고정을 위해 최초 1회만
  const [initialNickname] = useState(() => loadIdentity().nickname ?? "");
  const [lastNickname, setLastNickname] = useState(initialNickname);

  const handleJoin = (nickname: string) => {
    setLastNickname(nickname);
    onJoin(nickname);
  };

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-sky-950 p-6 text-white">
      <h1 className="text-3xl font-black">🐧 펭귄 빙판 걷기</h1>
      <p className="text-sm text-sky-300">방 코드: {roomId}</p>

      {rejectReason && (
        <p role="alert" className="rounded-xl bg-rose-500/20 px-4 py-3 text-center font-semibold text-rose-200">
          {REJECT_MESSAGES[rejectReason] ?? "입장할 수 없어요"}
        </p>
      )}
      {connectFailed && (
        <div className="flex flex-col items-center gap-3">
          <p role="alert" className="rounded-xl bg-rose-500/20 px-4 py-3 text-center font-semibold text-rose-200">
            방에 연결하지 못했어요. 호스트와 같은 Wi-Fi면 더 잘 돼요.
          </p>
          <button
            type="button"
            onClick={() => lastNickname && onJoin(lastNickname)}
            className="rounded-xl bg-sky-700 px-6 py-3 font-bold text-white active:scale-95"
          >
            다시 시도
          </button>
        </div>
      )}

      <NicknameForm initialNickname={initialNickname} onSubmit={handleJoin} />
    </main>
  );
};

export default PlayJoinContainer;

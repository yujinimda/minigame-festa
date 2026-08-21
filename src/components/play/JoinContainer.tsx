"use client";

// US1 — 참가 화면: 닉네임 입력 → 입장, 거부/실패 사유 안내 (FR-002·003·004·020)

import { useState } from "react";
import NicknameForm from "@/src/components/play/NicknameForm";
import { MAX_PLAYERS } from "@/src/game/balance";
import { loadIdentity } from "@/src/p2p/player-client";

export interface TPlayJoinContainerProps {
  roomId: string;
  rejectReason: string | null;
  connectFailed: boolean;
  onJoin: (nickname: string) => void;
}

const REJECT_MESSAGES: Record<string, string> = {
  "room-full": `정원이 가득 찼어요 (최대 ${MAX_PLAYERS}명)`,
  "race-in-progress": "게임이 진행 중이에요 — 다음 판을 기다려주세요",
  "invalid-nickname": "닉네임이 올바르지 않아요 — 다시 입력해주세요",
};

const PlayJoinContainer = ({
  roomId,
  rejectReason,
  connectFailed,
  onJoin,
}: TPlayJoinContainerProps) => {
  // 닉네임 값은 여기가 소유 — 재시도(connectFailed)와 폼이 같은 현재 값을 쓴다
  const [nickname, setNickname] = useState(() => loadIdentity().nickname ?? "");

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
        <p role="alert" className="rounded-xl bg-rose-500/20 px-4 py-3 text-center font-semibold text-rose-200">
          방에 연결하지 못했어요. 호스트와 같은 Wi-Fi면 더 잘 돼요.
        </p>
      )}

      <NicknameForm
        nickname={nickname}
        onNicknameChange={setNickname}
        submitLabel={connectFailed ? "이 닉네임으로 다시 시도" : "입장하기 🐧"}
        onSubmit={onJoin}
      />
    </main>
  );
};

export default PlayJoinContainer;

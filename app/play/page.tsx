"use client";

// 플레이어 셸 — /play?room={roomId} (정적 export 호환, research.md R2).
// 화면 전환만 담당. 내용은 각 스토리 소유 컨테이너가 구현(F 이후 불변).

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PlayControllerContainer from "@/src/components/play/ControllerContainer";
import PlayJoinContainer from "@/src/components/play/JoinContainer";
import PersonalResultContainer from "@/src/components/play/PersonalResultContainer";
import MuteBadge from "@/src/components/shared/MuteBadge";
import RoomClosedNotice from "@/src/components/shared/RoomClosedNotice";
import { usePlayerSession } from "@/src/components/shared/usePlayerSession";
import { usePlayerStore } from "@/src/stores/player-store";

const PlayScreen = () => {
  const roomId = useSearchParams().get("room");
  const session = usePlayerSession();
  const { screen, status, rejectReason } = usePlayerStore();

  // 방 종료가 확정되면 세션 타이머를 접는다(더 이상 재접속 대상이 없음)
  const client = session.client;
  useEffect(() => {
    if (status === "closed") client?.destroy();
  }, [status, client]);

  if (!roomId) return <RoomCodeEntry />;

  if (status === "closed") return <RoomClosedNotice />;

  if (screen === "nickname" || screen === "rejected" || screen === "connect-failed") {
    return (
      <PlayJoinContainer
        roomId={roomId}
        rejectReason={screen === "rejected" ? rejectReason : null}
        connectFailed={screen === "connect-failed"}
        onJoin={(nickname) => session.join(roomId, nickname)}
      />
    );
  }

  return (
    <>
      <MuteBadge />
      {/* finished(넘어짐/완주 직후, race-end 전)는 컨트롤러가 유지해 피드백 연출을
          렌더한다(게이트8 B8) — 개인 결과 화면은 순위가 확정된 result에서만 */}
      {status === "result" ? (
        <PersonalResultContainer session={session} />
      ) : (
        <PlayControllerContainer session={session} />
      )}
    </>
  );
};

// QR을 못 찍는 경우의 수동 입장 경로 — 호스트 화면의 방 코드를 직접 입력 (R7)
const RoomCodeEntry = () => {
  const router = useRouter();
  const [code, setCode] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim().toLowerCase();
    if (!trimmed) return;
    router.replace(`/play?room=${encodeURIComponent(trimmed)}`);
  };

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-sky-950 p-6 text-white">
      <h1 className="text-2xl font-black">🐧 방 코드 입력</h1>
      <p className="text-center text-sky-300">
        QR을 못 찍겠다면 호스트 화면의 방 코드를 입력하세요
      </p>
      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-4">
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="mgf-abc123"
          autoCapitalize="off"
          autoComplete="off"
          enterKeyHint="go"
          className="rounded-xl border-2 border-sky-700 bg-sky-900 px-4 py-3 text-center font-mono text-xl text-white placeholder:text-sky-500 focus:border-amber-400 focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-xl bg-amber-400 py-4 text-xl font-black text-sky-950 active:scale-95"
        >
          입장
        </button>
      </form>
    </main>
  );
};

export default function PlayPage() {
  return (
    <Suspense fallback={null}>
      <PlayScreen />
    </Suspense>
  );
}

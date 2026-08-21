"use client";

// 플레이어 셸 — /play?room={roomId} (정적 export 호환, research.md R2).
// 화면 전환만 담당. 내용은 각 스토리 소유 컨테이너가 구현(F 이후 불변).

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
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

  if (!roomId) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-sky-950 p-8 text-center text-white">
        <p>방 코드가 없어요. 호스트 화면의 QR을 다시 찍어주세요.</p>
      </main>
    );
  }

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

export default function PlayPage() {
  return (
    <Suspense fallback={null}>
      <PlayScreen />
    </Suspense>
  );
}

"use client";

// 호스트 룸 수명주기 훅(F 소유) — 방 생성·스토어 동기화. 컨테이너는 반환 핸들만 소비.

import { useEffect } from "react";
import { createHostRoom, type THostRoomHandle } from "@/src/p2p/host-room";
import { useHostStore } from "@/src/stores/host-store";

export const useHostRoom = (): THostRoomHandle | null => {
  useEffect(() => {
    const { setReady, setError, syncRoom, setRoomHandle } = useHostStore.getState();
    const room = createHostRoom({
      onReady: (roomId) => setReady(roomId),
      onError: (error) => setError(error.message),
      onChange: () => {
        syncRoom({
          phase: room.core.getPhase(),
          roster: room.core.getRoster(),
          results: room.core.getResults(),
        });
      },
    });
    setRoomHandle(room);
    return () => {
      setRoomHandle(null);
      room.destroy();
    };
  }, []);

  return useHostStore((s) => s.roomHandle);
};

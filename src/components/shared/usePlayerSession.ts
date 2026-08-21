"use client";

// 플레이어 세션 수명주기 훅(F 소유) — 접속·스토어 동기화·오디오 언락.
// 컨테이너는 join()과 반환 핸들만 소비.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { unlockAudio } from "@/src/audio/sound";
import {
  createPlayerClient,
  loadIdentity,
  saveNickname,
  type TPlayerClientHandle,
} from "@/src/p2p/player-client";
import { usePlayerStore } from "@/src/stores/player-store";

export interface TPlayerSession {
  client: TPlayerClientHandle | null;
  join: (roomId: string, nickname: string) => Promise<void>;
}

export const usePlayerSession = (): TPlayerSession => {
  const clientRef = useRef<TPlayerClientHandle | null>(null);
  const [client, setClient] = useState<TPlayerClientHandle | null>(null);

  const join = useCallback(async (roomId: string, nickname: string) => {
    const store = usePlayerStore.getState();
    // 입장 제스처 = 오디오 언락 지점(FR-025). 실패 시 음소거 배지 표시
    const unlocked = await unlockAudio();
    store.setMuted(!unlocked);

    const identity = loadIdentity();
    saveNickname(nickname);

    clientRef.current?.destroy();
    const client = createPlayerClient({
      roomId,
      playerId: identity.playerId,
      nickname,
      onChange: () => {
        const core = client.core;
        usePlayerStore.getState().sync({
          status: core.getStatus(),
          nickname: core.getNickname(),
          roster: core.getRoster(),
          results: core.getResults(),
        });
      },
      onRejected: (reason) => usePlayerStore.getState().setRejected(reason),
      onConnectFailed: () => usePlayerStore.getState().setScreen("connect-failed"),
    });
    clientRef.current = client;
    setClient(client);
    store.setScreen("game");
  }, []);

  // 언마운트 시 세션 정리(게이트8 B4) — 없으면 유령 하트비트가 호스트 정원을 계속 점유한다
  useEffect(
    () => () => {
      clientRef.current?.destroy();
      clientRef.current = null;
    },
    [],
  );

  return useMemo(() => ({ client, join }), [client, join]);
};

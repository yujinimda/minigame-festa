// 플레이어 화면 상태 — 진실은 player-client 코어에 있고, 스토어는 렌더용 미러.
"use client";

import { create } from "zustand";
import type { TPlayerStatus } from "@/src/p2p/player-client";
import type { TRaceResult, TRosterEntry } from "@/src/p2p/protocol";

export type TPlayerScreen =
  | "nickname" // 닉네임 입력 (초기)
  | "rejected" // join-rejected 안내
  | "connect-failed" // 접속 실패 — 재시도 UI
  | "game"; // joined 이후 전 상태 (status로 세분)

interface TPlayerStore {
  screen: TPlayerScreen;
  status: TPlayerStatus;
  nickname: string | null;
  rejectReason: string | null;
  roster: TRosterEntry[];
  results: TRaceResult[] | null;
  muted: boolean; // FR-025: 오디오 언락 실패 표시
  setScreen: (screen: TPlayerScreen) => void;
  setRejected: (reason: string) => void;
  setMuted: (muted: boolean) => void;
  sync: (data: {
    status: TPlayerStatus;
    nickname: string | null;
    roster: TRosterEntry[];
    results: TRaceResult[] | null;
  }) => void;
}

export const usePlayerStore = create<TPlayerStore>((set) => ({
  screen: "nickname",
  status: "idle",
  nickname: null,
  rejectReason: null,
  roster: [],
  results: null,
  muted: false,
  setScreen: (screen) => set({ screen }),
  setRejected: (reason) => set({ screen: "rejected", rejectReason: reason }),
  setMuted: (muted) => set({ muted }),
  sync: (data) => set(data),
}));

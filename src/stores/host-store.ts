// 호스트 화면 상태 — 진실은 host-room 코어에 있고, 스토어는 렌더용 미러.
"use client";

import { create } from "zustand";
import type { THostRoomHandle } from "@/src/p2p/host-room";
import type { TPhase, TRaceResult, TRosterEntry } from "@/src/p2p/protocol";

export type THostScreenStatus = "opening" | "ready" | "error";

interface THostStore {
  status: THostScreenStatus;
  roomHandle: THostRoomHandle | null;
  roomId: string | null;
  phase: TPhase; // lobby → countdown → race → result → lobby(다시 하기)
  roster: TRosterEntry[];
  results: TRaceResult[] | null;
  errorMessage: string | null;
  setRoomHandle: (handle: THostRoomHandle | null) => void;
  setReady: (roomId: string) => void;
  setError: (message: string) => void;
  syncRoom: (snapshot: { phase: TPhase; roster: TRosterEntry[]; results: TRaceResult[] | null }) => void;
}

export const useHostStore = create<THostStore>((set) => ({
  status: "opening",
  roomHandle: null,
  roomId: null,
  phase: "lobby",
  roster: [],
  results: null,
  errorMessage: null,
  setRoomHandle: (roomHandle) => set({ roomHandle }),
  setReady: (roomId) => set({ status: "ready", roomId }),
  setError: (message) => set({ status: "error", errorMessage: message }),
  syncRoom: ({ phase, roster, results }) => set({ phase, roster, results }),
}));

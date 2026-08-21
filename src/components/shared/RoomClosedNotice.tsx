"use client";

// 호스트 소멸 안내(F 소유 공용 컴포넌트) — 계약 §연결 수명 규칙

const RoomClosedNotice = () => (
  <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-sky-950 p-8 text-center text-white">
    <p className="text-6xl">🧊</p>
    <h1 className="text-2xl font-bold">방이 종료됐어요</h1>
    <p className="text-sky-200">호스트 화면이 닫혔거나 연결이 끊겼습니다.</p>
  </main>
);

export default RoomClosedNotice;

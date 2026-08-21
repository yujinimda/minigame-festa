import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-sky-950 p-8 text-center text-white">
      <h1 className="text-5xl font-black tracking-tight">
        🐧 미니게임 페스타
      </h1>
      <p className="text-lg text-sky-200">
        큰 화면에 방을 열고, 다들 폰으로 QR을 찍어 들어오세요.
        <br />
        펭귄 빙판 걷기 — 최대 15명 레이스!
      </p>
      <Link
        href="/host"
        className="rounded-2xl bg-amber-400 px-10 py-5 text-2xl font-bold text-sky-950 shadow-lg transition hover:scale-105"
      >
        방 만들기 (큰 화면에서)
      </Link>
    </main>
  );
}

"use client";

// 닉네임 입력 폼 — 검증(빈 값·공백 거부, 길이 제한)과 안내 표시(FR-003).
// 제어 컴포넌트: 값은 부모(JoinContainer)가 소유해 재시도 흐름과 공유한다

import { useState } from "react";
import { NICKNAME_MAX_LENGTH } from "@/src/game/balance";

interface TNicknameFormProps {
  nickname: string;
  onNicknameChange: (value: string) => void;
  submitLabel?: string;
  onSubmit: (nickname: string) => void;
}

const NicknameForm = ({
  nickname,
  onNicknameChange,
  submitLabel = "입장하기 🐧",
  onSubmit,
}: TNicknameFormProps) => {
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = nickname.trim();
    if (trimmed.length === 0) {
      setError("닉네임을 입력해주세요");
      return;
    }
    setError(null);
    onSubmit(trimmed.slice(0, NICKNAME_MAX_LENGTH));
  };

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4">
      <label htmlFor="nickname" className="text-lg font-bold">
        닉네임
      </label>
      <input
        id="nickname"
        type="text"
        value={nickname}
        maxLength={NICKNAME_MAX_LENGTH}
        onChange={(e) => onNicknameChange(e.target.value)}
        placeholder={`최대 ${NICKNAME_MAX_LENGTH}자`}
        enterKeyHint="go"
        autoComplete="nickname"
        autoCapitalize="off"
        aria-invalid={error !== null}
        aria-describedby={error ? "nickname-error" : undefined}
        className="rounded-xl border-2 border-sky-700 bg-sky-900 px-4 py-3 text-xl text-white placeholder:text-sky-400 focus:border-amber-400 focus:outline-none"
      />
      {error && (
        <p id="nickname-error" role="alert" className="text-sm font-semibold text-rose-300">
          {error}
        </p>
      )}
      <button
        type="submit"
        className="rounded-xl bg-amber-400 py-4 text-xl font-black text-sky-950 transition active:scale-95"
      >
        {submitLabel}
      </button>
    </form>
  );
};

export default NicknameForm;

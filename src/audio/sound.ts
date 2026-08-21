// 오디오·햅틱 — Web Audio 직접 사용(라이브러리 없음).
// 모바일 자동재생 제약: 입장 제스처에서 unlock() 호출(FR-025).
// iOS Safari는 Vibration API 미지원 → vibrate()는 지원 여부를 반환하고
// 호출부가 시각 플래시 폴백을 켠다(research.md R5).
"use client";

type TSfxName = "tap" | "countdown" | "start" | "fall" | "finish" | "result";

// 외부 에셋 없이 Web Audio 오실레이터로 합성하는 파티톤 효과음
const SFX_RECIPES: Record<TSfxName, { freq: number[]; duration: number; type: OscillatorType }> = {
  tap: { freq: [880], duration: 0.05, type: "square" },
  countdown: { freq: [660], duration: 0.12, type: "sine" },
  start: { freq: [523, 659, 784], duration: 0.4, type: "sine" },
  fall: { freq: [400, 200, 100], duration: 0.5, type: "sawtooth" },
  finish: { freq: [784, 988], duration: 0.3, type: "sine" },
  result: { freq: [523, 659, 784, 1047], duration: 0.8, type: "sine" },
};

let ctx: AudioContext | null = null;
let unlocked = false;

export const unlockAudio = async (): Promise<boolean> => {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") await ctx.resume();
    unlocked = ctx.state === "running";
  } catch {
    unlocked = false;
  }
  return unlocked;
};

export const isAudioUnlocked = (): boolean => unlocked;

export const playSfx = (name: TSfxName): void => {
  if (!ctx || !unlocked) return;
  const { freq, duration, type } = SFX_RECIPES[name];
  const stepDuration = duration / freq.length;
  freq.forEach((f, i) => {
    const osc = ctx!.createOscillator();
    const gain = ctx!.createGain();
    osc.type = type;
    osc.frequency.value = f;
    const t0 = ctx!.currentTime + i * stepDuration;
    gain.gain.setValueAtTime(0.15, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + stepDuration);
    osc.connect(gain).connect(ctx!.destination);
    osc.start(t0);
    osc.stop(t0 + stepDuration);
  });
};

// 진동 — 반환 false면 미지원(iOS Safari): 호출부가 시각 플래시로 폴백
export const vibrate = (pattern: number | number[]): boolean => {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") {
    return false;
  }
  return navigator.vibrate(pattern);
};

// 호스트 BGM — <audio loop>는 에셋이 필요하므로 오실레이터 루프 대신
// 시작 제스처 후 재생되는 심플 루프(에셋 도입 시 교체 지점)
let bgmTimer: ReturnType<typeof setInterval> | null = null;

export const startBgm = (): void => {
  if (!ctx || !unlocked || bgmTimer) return;
  const notes = [523, 587, 659, 784, 659, 587];
  let step = 0;
  bgmTimer = setInterval(() => {
    if (!ctx || !unlocked) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = notes[step % notes.length];
    gain.gain.setValueAtTime(0.04, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
    step += 1;
  }, 300);
};

export const stopBgm = (): void => {
  if (bgmTimer) {
    clearInterval(bgmTimer);
    bgmTimer = null;
  }
};

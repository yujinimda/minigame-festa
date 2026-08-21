// US2 — 호스트 레이스 뷰(Phaser 3 씬). React 리렌더 없이 rAF에서
// host-room 코어를 직접 폴링한다(R6·게이트8 B9). 이 모듈은 phaser를 정적 import
// 하므로 반드시 동적 import(RaceContainer)로만 로드한다 — 초기 번들 제외.

import * as Phaser from "phaser";
import { playSfx, startBgm, stopBgm } from "@/src/audio/sound";
import { TILT_LIMIT } from "@/src/game/balance";
import type { TRacePosition } from "@/src/p2p/host-room";

export interface TRaceSceneSource {
  getPositions: () => TRacePosition[];
  getCountdownRemainingMs: () => number | null;
  getRaceRemainingMs: () => number | null;
}

const W = 1280;
const H = 720;
const TRACK_LEFT = 200;
const TRACK_RIGHT = W - 120;
// 러버밴드 최소 스케일(보) — 30초 × 평균 2탭/초 ≈ 60보를 기준으로, 초반(선두 40보
// 이하)에도 트랙이 텅 비어 보이지 않는 하한. 뷰 전용 상수라 balance.ts 밖(플레이테스트 조정 대상)
const MIN_GOAL = 40;

interface TLaneSprite {
  penguin: Phaser.GameObjects.Text;
  label: Phaser.GameObjects.Text;
  distanceText: Phaser.GameObjects.Text;
  fallen: boolean;
  x: number;
}

class RaceScene extends Phaser.Scene {
  private source: TRaceSceneSource;
  private lanes = new Map<string, TLaneSprite>();
  private countdownText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private startAnnounced = false;
  private lastCountdownSecond = -1;

  constructor(source: TRaceSceneSource) {
    super("race");
    this.source = source;
  }

  create(): void {
    // 빙판 배경
    this.add.rectangle(W / 2, H / 2, W, H, 0xdbeefe);
    for (let i = 0; i < 8; i += 1) {
      this.add
        .rectangle(W / 2, (H / 8) * i, W, 2, 0xbcdcf5)
        .setOrigin(0.5, 0);
    }
    // 결승 방향 안내
    this.add
      .text(TRACK_RIGHT + 40, H / 2, "❄️", { fontSize: "48px" })
      .setOrigin(0.5)
      .setAngle(0);

    // 넘어짐 파편 파티클용 텍스처(에셋 없이 생성)
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(4, 4, 4);
    g.generateTexture("ice-bit", 8, 8);
    g.destroy();

    this.countdownText = this.add
      .text(W / 2, H / 2, "", {
        fontSize: "160px",
        fontStyle: "bold",
        color: "#0c4a6e",
      })
      .setOrigin(0.5)
      .setDepth(10);

    this.timerText = this.add
      .text(W - 24, 24, "", { fontSize: "40px", fontStyle: "bold", color: "#0c4a6e" })
      .setOrigin(1, 0)
      .setDepth(10);

    this.buildLanes();
    startBgm();
  }

  private buildLanes(): void {
    const positions = this.source.getPositions();
    const count = Math.max(positions.length, 1);
    const laneHeight = Math.min(80, (H - 120) / count);
    positions.forEach((pos, index) => {
      const y = 90 + laneHeight * index + laneHeight / 2;
      this.add.rectangle(W / 2, y + laneHeight / 2 - 4, W - 80, 1, 0x93c5fd);
      const label = this.add
        .text(24, y, pos.nickname, { fontSize: "24px", fontStyle: "bold", color: "#075985" })
        .setOrigin(0, 0.5);
      const penguin = this.add
        .text(TRACK_LEFT, y, "🐧", { fontSize: `${Math.min(52, laneHeight - 8)}px` })
        .setOrigin(0.5);
      const distanceText = this.add
        .text(W - 24, y, "0보", { fontSize: "22px", color: "#0369a1" })
        .setOrigin(1, 0.5);
      this.lanes.set(pos.playerId, { penguin, label, distanceText, fallen: false, x: TRACK_LEFT });
    });
  }

  private onFall(lane: TLaneSprite): void {
    lane.fallen = true;
    playSfx("fall");
    this.cameras.main.shake(250, 0.008);
    // 주르륵 미끄러지는 연출(FR-016)
    this.tweens.add({
      targets: lane.penguin,
      angle: 90,
      x: lane.penguin.x + 70,
      duration: 600,
      ease: "Cubic.easeOut",
    });
    this.add.particles(lane.penguin.x, lane.penguin.y, "ice-bit", {
      speed: { min: 60, max: 200 },
      lifespan: 500,
      quantity: 14,
      stopAfter: 14,
      gravityY: 300,
    });
  }

  update(): void {
    const positions = this.source.getPositions();
    const leader = positions.reduce((max, p) => Math.max(max, p.distance), 0);
    const goal = Math.max(MIN_GOAL, leader + 8);

    for (const pos of positions) {
      const lane = this.lanes.get(pos.playerId);
      if (!lane) continue;
      const targetX = TRACK_LEFT + (pos.distance / goal) * (TRACK_RIGHT - TRACK_LEFT);
      lane.x = Phaser.Math.Linear(lane.x, targetX, 0.12);
      lane.distanceText.setText(`${pos.distance}보`);
      if (!lane.fallen) {
        lane.penguin.x = lane.x;
        lane.penguin.setAngle((pos.tilt / TILT_LIMIT) * 35);
        if (pos.fallen) this.onFall(lane);
      }
    }

    // 카운트다운 / 잔여 시간
    const countdown = this.source.getCountdownRemainingMs();
    if (countdown !== null && countdown > 0) {
      const second = Math.ceil(countdown / 1000);
      if (second !== this.lastCountdownSecond) {
        this.lastCountdownSecond = second;
        playSfx("countdown"); // FR-024 카운트다운 효과음(3·2·1)
      }
      this.countdownText.setText(String(second));
      this.timerText.setText("");
    } else {
      if (!this.startAnnounced) {
        this.startAnnounced = true;
        this.countdownText.setText("출발! 🐧");
        playSfx("start");
        this.time.delayedCall(900, () => this.countdownText.setText(""));
      }
      const totalRemaining = this.source.getRaceRemainingMs();
      if (totalRemaining !== null) {
        this.timerText.setText(`${Math.max(0, Math.ceil(totalRemaining / 1000))}s`);
      }
    }
  }
}

export interface TRaceGameHandle {
  destroy: () => void;
}

export const buildRaceGame = (
  parent: HTMLElement,
  source: TRaceSceneSource,
): TRaceGameHandle => {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: "#dbeefe",
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: W,
      height: H,
    },
    scene: new RaceScene(source),
  });
  return {
    destroy: () => {
      stopBgm();
      game.destroy(true);
    },
  };
};

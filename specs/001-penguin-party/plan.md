# Implementation Plan: 미니게임 페스타 — 펭귄 빙판 걷기

**Branch**: `spec/001-penguin-party` (개발은 `feat/001-*`) | **Date**: 2026-08-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-penguin-party/spec.md`

## Summary

최대 15명이 폰으로 QR을 찍어 참가하는 파티 레이스 게임. 호스트 브라우저(큰 화면)가
PeerJS(WebRTC) 방을 열어 서버 역할을 하고, 플레이어 폰은 좌/우 교대 탭으로 펭귄을
전진시키며 판정(거리·기울기·넘어짐)을 로컬에서 수행해 상태만 호스트로 전송한다.
백엔드 없이 Vercel 무료 호스팅 + PeerJS 공식 시그널링만 사용(운영비 0원).

## Technical Context

**Language/Version**: TypeScript 5.x (strict), Node.js 24 (빌드 환경)

**Primary Dependencies**: Next.js 16(App Router) · React 19 · peerjs ^1.5 · phaser ^3(호스트 레이스 뷰 전용, dynamic import) · qrcode.react · zustand

**Storage**: 없음(방 상태는 호스트 브라우저 메모리, playerId만 폰 localStorage)

**Testing**: Vitest(게임 로직·프로토콜 단위 테스트) + Playwright(호스트/플레이어 2-컨텍스트 스모크 E2E)

**Target Platform**: 플레이어 — iOS Safari(기준 iPhone 13)·Android Chrome 최근 2년, 세로 모드 / 호스트 — 데스크톱 Chrome

**Project Type**: 웹 앱(단일 Next.js 프로젝트, `output: 'export'` 완전 정적 — API 라우트·서버 코드 없음)

**Performance Goals**: 호스트 레이스 뷰 60fps, 폰 입력 → 호스트 반영 ≤ 0.5s(SC-002), 15명 동시 연결

**Constraints**: 운영비 0원(FR-018) · 백엔드 금지 · 호스트 종료 시 방 소멸 수용 · iOS Vibration API 미지원 → 시각/사운드 폴백(FR-025에 명시) · PeerJS Cloud 공유 인프라 제약(ID 충돌 재발급·타임아웃 UX·15인 실기기 go/no-go 게이트 — research R1)

**Scale/Scope**: 방당 최대 15명, 화면 4종(랜딩/호스트/참가/컨트롤러+결과), 미니게임 1종

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md`가 미제정(템플릿 상태) — 강제 게이트 없음.
프로젝트 관례로 다음을 자체 게이트로 적용: ① 백엔드/유료 서비스 도입 금지(FR-018)
② 판정은 플레이어 로컬(FR-013) ③ 게임 규칙 로직은 UI와 분리된 순수 함수로 작성(테스트 가능성).
Phase 1 설계 후 재점검: 위반 없음.

## Project Structure

### Documentation (this feature)

```text
specs/001-penguin-party/
├── design.md            # 브레인스토밍 산출물
├── spec.md              # 기능 스펙 (grill-me 통과, NEEDS CLARIFICATION 0)
├── plan.md              # 이 파일
├── research.md          # Phase 0 산출물
├── data-model.md        # Phase 1 산출물
├── quickstart.md        # Phase 1 산출물
├── contracts/
│   └── p2p-protocol.md  # 호스트↔플레이어 메시지 계약
└── tasks.md             # Phase 2 산출물 (/speckit-tasks)
```

### Source Code (repository root)

```text
app/
├── layout.tsx               # 루트 레이아웃(한국어, 뷰포트)
├── page.tsx                 # 랜딩 — "방 만들기" → /host
├── host/
│   └── page.tsx             # 호스트: QR+로비 → 레이스 뷰 → 순위 (단일 페이지 상태 전환)
└── play/
    └── page.tsx             # 플레이어: /play?room={id} (useSearchParams) — 닉네임 → 컨트롤러 → 개인 결과
                             #   컨트롤러에 온보딩 카피("좌우 번갈아 탭!") — 카운트다운 중 노출(SC-003)

src/
├── game/
│   ├── penguin.ts           # 판정 순수 로직(전진·기울기·넘어짐·드리프트) — UI 무의존
│   └── balance.ts           # 밸런스 상수(전진량·회복량·페널티·드리프트·임계값·제한시간)
├── p2p/
│   ├── protocol.ts          # 메시지 타입·버전·raceId/seq (contracts/p2p-protocol.md와 1:1)
│   ├── host-room.ts         # 호스트: Peer 생성·ID충돌 재발급·연결 수락(control/state 2채널)·하트비트 감시·로스터·스냅샷
│   └── player-client.ts     # 플레이어: 접속(10s 타임아웃)·재접속 백오프·하트비트·상태 송신(10Hz, unreliable)
├── stores/
│   ├── host-store.ts        # zustand — 방 상태 머신(lobby→race→result)
│   └── player-store.ts      # zustand — 플레이어 상태 머신
├── audio/
│   └── sound.ts             # 오디오 언락·BGM·효과음·진동(폴백 포함)
├── game-view/
│   └── race-scene.ts        # Phaser 3 씬 — 트랙 15레인·펭귄 스프라이트·넘어짐 트윈/파티클·쉐이크 (호스트 전용)
└── components/
    ├── host/                # QrPanel, LobbyList, RaceContainer(Phaser 마운트), RankingBoard
    └── play/                # NicknameForm, Controller(좌/우 버튼), TiltGauge, PersonalResult

tests/
├── unit/                    # penguin.ts·protocol·host-room 로스터 규칙 (Vitest)
└── e2e/                     # 호스트+플레이어 2-컨텍스트 스모크 (Playwright)
```

**Structure Decision**: 단일 Next.js 프로젝트(레포 루트). 서버 코드가 없으므로
frontend/backend 분리 불필요. 게임 규칙(`src/game/`)과 전송(`src/p2p/`)을 UI에서
분리해 코덱스 테스트(역할 역전)가 순수 함수를 직접 검증할 수 있게 한다.

## Complexity Tracking

위반 없음 — 해당 없음.

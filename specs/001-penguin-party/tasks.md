# Tasks: 미니게임 페스타 — 펭귄 빙판 걷기

**Input**: Design documents from `specs/001-penguin-party/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/p2p-protocol.md

**Tests**: 포함 — 워크플로우 역할 역전: **테스트는 구현 컨텍스트가 없는 독립
테스트 작성 에이전트(Opus 4.6)가 스펙·계약만 보고 작성**하고, 기능 에이전트가
통과시킨다. 해당 태스크는 `(test-writer)` 표기. 크로스 검증 게이트(5·6.5·8)도
Opus 4.6 독립 에이전트가 수행한다(2026-08-21 프로세스 변경 — 기존 codex exec 대체).

**Organization**: 스토리 단위 병렬 구현(스토리 = 워크트리 = 브랜치 = 에이전트 N).
같은 워크스페이스를 공유하므로 **담당 파일 겹침 금지** — 소유권 표 참조.

## Format: `[ID] [P?] [Story] Description`

## 파일 소유권 (충돌 방지 — 위반 시 8번 리뷰 전 기계 확인에서 걸림)

| 소유자 | 파일 |
|---|---|
| **F (Foundation 워크트리)** | 프로젝트 설정 전부, `src/game/*`, `src/p2p/*`, `src/stores/*`, `src/audio/*`, `app/layout.tsx`, `app/page.tsx`, `app/host/page.tsx`·`app/play/page.tsx`(phase 스위치 셸 + 컨테이너 스텁), `src/components/shared/*` |
| **US1 워크트리** | `src/components/host/LobbyContainer.tsx`, `QrPanel.tsx`, `LobbyList.tsx`, `src/components/play/JoinContainer.tsx`, `NicknameForm.tsx` |
| **US2 워크트리** | `src/components/host/RaceContainer.tsx`, `src/game-view/race-scene.ts`, `src/components/play/ControllerContainer.tsx`, `Controller.tsx`, `TiltGauge.tsx` |
| **US3 워크트리** | `src/components/host/ResultContainer.tsx`, `RankingBoard.tsx`, `src/components/play/PersonalResultContainer.tsx` |
| **테스트(test-writer, Opus 4.6)** | `tests/**` — 소유자별 하위 폴더로 분리: `tests/unit/game/`·`tests/unit/p2p/`는 F, `tests/unit/us1/`은 US1, `tests/unit/us2/`는 US2, `tests/unit/us3/`은 US3, `tests/e2e/`는 통합 |

- 페이지 셸은 F가 만든 **컨테이너 스텁을 각 스토리가 자기 파일에서 구현**하는
  방식이라 스토리끼리 같은 파일을 만지지 않는다. 셸 자체는 F 이후 불변.
- 공유 지점 단일 소유(6번 규칙): F 소유 파일 전체(`src/p2p/*`·`src/game/*`·`src/stores/*`·
  `src/audio/*`·페이지 셸)는 F 머지 후 **스토리 워크트리에서 수정 금지**. 스토리 작업 중
  계약·로직 변경이 필요해지면 코디네이터에 에스컬레이션(코디네이터가 수정·재머지 판단).
  스토리의 권위 로직 검증은 T009(F 테스트)가 선행 담당 — 스토리 테스트는 자기 소유
  컴포넌트만 다루고 F 모듈은 목킹한다.

## Phase 1: Setup (Shared Infrastructure) — F 워크트리

- [ ] T001 Next.js 16 프로젝트 스캐폴드(TypeScript strict, App Router, Tailwind) + `next.config.ts`에 `output: 'export'` 설정, 레포 루트
- [ ] T002 의존성·스크립트 일괄 추가 — **`package.json`은 이 태스크만 수정**(병렬 충돌 방지): peerjs, phaser, qrcode.react, zustand, vitest, @testing-library/react, playwright + `test`/`e2e` 스크립트
- [ ] T003 [P] Vitest 설정 `vitest.config.ts` (package.json 수정 없음)
- [ ] T004 [P] Playwright 설정 `playwright.config.ts`(desktop+mobile 프로젝트, dev 서버 자동 기동) (package.json 수정 없음)

## Phase 2: Foundational (Blocking Prerequisites) — F 워크트리

**⚠️ CRITICAL**: 이 페이즈 완료(머지) 전에는 어떤 스토리도 시작 불가

- [ ] T005 [P] 밸런스 상수 `src/game/balance.ts` — data-model.md 표 그대로(RACE_DURATION_MS 30000, TILT_LIMIT 100, STEP_DISTANCE 1, TILT_RECOVER_PER_STEP 8, TILT_PENALTY_SAME_SIDE 35, DRIFT_PER_SEC 25, DRIFT_GRACE_MS 700, MIN_TAP_INTERVAL_MS 60, STATE_SEND_HZ 10, MAX_PLAYERS 15, COUNTDOWN_MS 3000 + 하트비트 2000/6000/20000)
- [ ] T006 [P] 메시지 타입 `src/p2p/protocol.ts` — contracts/p2p-protocol.md와 1:1 (v1, raceId/seq, 채널 구분, RoomSnapshot)
- [ ] T007 (test-writer) 게임 판정 단위 테스트 `tests/unit/game/penguin.test.ts` — spec FR-008~012·데이터모델 기준: 교대 전진·회복, 같은쪽 페널티, 드리프트·grace, |tilt|≥100 넘어짐, MIN_TAP_INTERVAL 무시, distanceReachedAt 갱신. **T008보다 먼저 작성, 실패 확인**
- [ ] T008 판정 순수 로직 `src/game/penguin.ts` — `createRaceState()`, `applyTap(state, side, now)`, `applyDrift(state, dt)` (T007 통과가 완료 조건)
- [ ] T009 (test-writer) P2P·로스터·수명주기 단위 테스트 — **호스트/플레이어 권위 로직 전부 F에서 선행 검증**(스토리 테스트가 F 모듈을 검증하지 않도록): `tests/unit/p2p/protocol.test.ts`(stale seq/raceId 폐기, 스냅샷 직렬화 왕복), `tests/unit/p2p/host-room.test.ts`(빈 닉네임 거부·15정원(재접속 미산입)·중복 접미사 " (2)"·로비 외 phase 입장 거부·playerId 재접속 승계 — FR-003·004·020·026 / race-start→race-end 집계·끊김 시 마지막 state 확정(FR-019)·동점 3단계 타이브레이크(FR-021)·**return-lobby 브로드캐스트 후 raceId 증가·기록 초기화·멤버 유지(FR-017)**), `tests/unit/p2p/player-client.test.ts`(로컬 타이머·재접속 백오프·하트비트 6s/20s 룰)
- [ ] T010 호스트 룸 코어 `src/p2p/host-room.ts` — Peer 생성·ID충돌 재발급·control/state 2채널 수락·join/재접속(스냅샷)·**권위 판정: 정원 검사·닉네임 검증/중복 접미사·로비 외 입장 거부**·하트비트 감시·roster·race-start/end 브로드캐스트·순위 집계(동점 규칙)·**return-lobby 브로드캐스트(raceId 증가·기록 초기화·멤버 유지)** (T009 통과가 완료 조건)
- [ ] T011 플레이어 클라이언트 `src/p2p/player-client.ts` — 접속(10s 타임아웃)·재접속 백오프(1→2→4→10s)·heartbeat/ack·**ack 부재 20s 시 '방이 종료됨' 상태 노출(room-closed 동등 처리)**·state 10Hz 송신·bufferedAmount 가드·localStorage(playerId, nickname) (T009 통과가 완료 조건)
- [ ] T012 [P] 상태 스토어 `src/stores/host-store.ts`, `src/stores/player-store.ts` — phase 머신(lobby→countdown→race→result→**lobby(다시 하기 전이)**), roster
- [ ] T013 [P] 오디오·햅틱 `src/audio/sound.ts` — Web Audio 언락(제스처)·효과음·BGM 훅·vibrate 폴백(iOS 시각 플래시)·음소거 표시 상태
- [ ] T014 페이지 셸: `app/layout.tsx`(ko, viewport), `app/page.tsx`(랜딩→/host), `app/host/page.tsx`·`app/play/page.tsx`(useSearchParams+Suspense, phase 스위치로 컨테이너 렌더), 컨테이너 스텁 6개 `src/components/{host,play}/*Container.tsx` + 공용 UI `src/components/shared/`(**음소거 아이콘 표시 컴포넌트 포함** — FR-025, '방이 종료됨' 안내 포함)
- [ ] T015 `npm run lint && npm run build`(정적 export out/ 생성) 통과 확인 후 F 머지

**Checkpoint**: Foundation 머지 완료 — US1·US2·US3 워크트리 병렬 시작 가능

## Phase 3: User Story 1 - 방 만들기와 참가 (P1) 🎯 MVP

**Goal**: QR → 닉네임 → 로비 입장, 호스트 로비 실시간 표시

**Independent Test**: quickstart §1 — 폰 2대 QR 입장, 로비 표시·정원·중복 닉네임

- [ ] T016 (test-writer) [US1] 참가 UI 컨테이너 테스트 `tests/unit/us1/join-lobby.test.tsx` — **US1 소유 컴포넌트만 대상, F 모듈(p2p·스토어)은 목킹**: NicknameForm 1~10자 검증·localStorage 프리필, join-rejected 사유별 안내 렌더(정원·진행중·닉네임), LobbyList 로스터·연결상태 렌더, 시작 버튼 2명 미만 비활성(FR-006)
- [ ] T017 [P] [US1] 호스트 로비 UI `src/components/host/LobbyContainer.tsx` + `QrPanel.tsx`(qrcode.react, `{origin}/play?room={id}` + 코드 병기) + `LobbyList.tsx`(연결 상태 표시, 시작 버튼 — 2명 미만 비활성)
- [ ] T018 [P] [US1] 참가 UI `src/components/play/JoinContainer.tsx` + `NicknameForm.tsx`(1~10자 검증, localStorage 프리필, 입장 제스처에서 오디오 언락, join-rejected 사유별 안내: 정원·진행중·닉네임)
- [ ] T019 [US1] 로비 배선: host-room join 흐름 ↔ 스토어 ↔ UI 연결, T016 통과 확인

**Checkpoint**: US1 단독 검증 가능(quickstart §1) — 머지 1순위

## Phase 4: User Story 2 - 펭귄 빙판 걷기 플레이 (P1)

**Goal**: 시작→카운트다운→30초 레이스, 폰 조작→호스트 레이스 뷰 반영

**Independent Test**: quickstart §2 — 교대 탭 전진·연속 탭 넘어짐·드리프트·30초 종료

- [ ] T020 (test-writer) [US2] 컨트롤러 UI 테스트 `tests/unit/us2/controller.test.tsx` — **US2 소유 컴포넌트만 대상, F 모듈은 목킹**(레이스 수명주기는 T009가 F에서 검증 완료): Controller 탭→applyTap 위임·좌우 버튼 렌더·온보딩 카피 카운트다운 중 노출·넘어짐 후 입력 무시 표시, TiltGauge ±100 클램프 표시
- [ ] T021 [P] [US2] 컨트롤러 `src/components/play/ControllerContainer.tsx` + `Controller.tsx`(좌/우 대형 버튼, 온보딩 카피 "좌우 번갈아 탭!" 카운트다운 중 노출, 탭 피드백 진동/플래시) + `TiltGauge.tsx`(±100 클램프 표시)
- [ ] T022 [P] [US2] 레이스 뷰 `src/components/host/RaceContainer.tsx`(next/dynamic ssr:false로 Phaser 마운트/언마운트) + `src/game-view/race-scene.ts`(Phaser 3 씬 — 가로 트랙 15레인, 스냅샷 ref 구독 렌더, 기울기 반영 스프라이트, 넘어짐 미끄러짐 트윈+파티클+카메라 쉐이크)
- [ ] T023 [US2] 레이스 배선: 카운트다운·rAF 게임 루프(applyTap/applyDrift)·10Hz 송신·호스트 수집→트랙 갱신·이중 마감(로컬 30s + 호스트 마감)·사운드 이벤트, T020 통과 확인

**Checkpoint**: US1+US2 = 플레이 가능한 게임 — 머지 2순위. 단, 30초 종료 후
"결과 화면"은 US3 머지 전이므로 **스텁 ResultContainer 렌더까지만 검증**

## Phase 5: User Story 3 - 순위 발표 (P2)

**Goal**: 호스트 전체 순위 + 폰 개인 결과 + 다시 하기

**Independent Test**: quickstart §3 — 거리 순위 일치·동점 규칙·재경기

- [ ] T024 (test-writer) [US3] 결과 UI 테스트 `tests/unit/us3/result.test.tsx` — **US3 소유 컴포넌트만 대상, F 모듈은 목킹**(순위 집계·return-lobby 로직은 T009가 F에서 검증 완료): RankingBoard 내림차순 렌더·1등 강조·넘어짐 표기·다시하기 버튼→return-lobby 호출 위임, PersonalResult 자기 등수·거리 강조
- [ ] T025 [P] [US3] 호스트 순위 `src/components/host/ResultContainer.tsx` + `RankingBoard.tsx`(1등 강조, 넘어짐 표기, 다시 하기 버튼)
- [ ] T026 [P] [US3] 개인 결과 `src/components/play/PersonalResultContainer.tsx`(자기 거리·등수 강조, 대기 안내)
- [ ] T027 [US3] 결과 배선: race-end→결과 화면(**결과 발표 효과음·BGM 전환 — FR-024**), return-lobby→로비 복귀, T024 통과 확인

**Checkpoint**: 3스토리 전부 동작 — 머지 3순위

## Phase 6: Polish & Cross-Cutting — 통합(코디네이터 워크트리)

- [ ] T028 (test-writer) E2E 스모크 `tests/e2e/party.spec.ts` — 데스크톱(호스트)+모바일 뷰포트 2명: 입장→시작→탭→결과→다시 하기 (실 PeerJS 연결)
- [ ] T029 quickstart.md 전 시나리오 수동 검증 + lint/build/test 전체 통과 확인
- [ ] T030 [P] 룩앤필 패스: 아기자기 파티 톤(펭귄·빙판 팔레트), 호스트 대화면 가독성, 폰 세로 최적화 — 기존 컴포넌트 스타일만 수정(파일 소유권은 이 시점부터 통합 워크트리로 이관)
- [ ] T031 계측 모드 구현(`?debug=1` — 탭/수신/rAF 렌더 타임스탬프 로깅 + heartbeat RTT 시계 보정, quickstart SC-002 절차의 전제) 후 Vercel 프리뷰 배포 + 실기기 체크리스트(quickstart §실기기) 수행
- [ ] T032 플레이테스트 게이트(quickstart §플레이테스트 — SC-001~005, 15인 go/no-go) 실행, 실패 항목은 research R1 결정지로 루프백

## Dependencies & Execution Order

### 머지 순서 (10번 단계 기준)

```
F(Phase 1-2) ──▶ US1 ──▶ US2 ──▶ US3 ──▶ 통합(Phase 6)
```

- F 머지 전 스토리 시작 금지(셸·계약·로직이 전부 F 소유)
- US2는 US1의 로비 없이도 스토어 조작으로 단독 테스트 가능하나, 머지는 우선순위 순서 고정
- Phase 6은 세 스토리 머지 후 최신 main 리베이스 상태에서 수행

### 스토리 내 순서

- (test-writer) 테스트 태스크 → 구현 태스크 (테스트 실패 확인 후 구현 시작)
- [P] 태스크는 서로 다른 파일 — 같은 워크트리 안에서 에이전트 병렬 가능

### 워커 규칙 (재확인)

1. 커밋 금지 — 코디네이터가 몰아서 커밋
2. 소유권 표 밖 파일 수정 금지 — `git diff --name-only`로 리뷰 전 기계 확인
3. 의존성 설치 금지 — orca.yaml setup 훅이 담당

## Parallel Example: Foundation 이후

```
워크트리 feat/001-us1: 에이전트A T017 ∥ 에이전트B T018, 이후 T019 (test-writer: T016 선행)
워크트리 feat/001-us2: 에이전트A T021 ∥ 에이전트B T022, 이후 T023 (test-writer: T020 선행)
워크트리 feat/001-us3: 에이전트A T025 ∥ 에이전트B T026, 이후 T027 (test-writer: T024 선행)
```

## Implementation Strategy

MVP = F + US1 + US2(참가하고 플레이 가능) → US3(순위)로 완성 → Phase 6에서
디자인·배포·플레이테스트. 각 스토리 완료 시점마다 quickstart 해당 절로 단독 검증.

# Data Model: 펭귄 빙판 걷기 (Phase 1)

모든 상태는 휘발성 — 호스트 브라우저 메모리가 단일 진실. 영속 데이터는 플레이어
폰 localStorage의 `{ playerId, nickname }` 뿐(playerId는 재접속 승계 키(FR-026),
nickname은 재접속 폼 프리필용).

## Room (방) — 호스트 소유

| 필드 | 타입 | 규칙 |
|---|---|---|
| roomId | string | `mgf-` + 소문자·숫자 6자. PeerJS Peer ID 겸용. ID 충돌(`unavailable-id`) 시 재발급 |
| phase | `'lobby' \| 'countdown' \| 'race' \| 'result'` | 상태 머신(아래) |
| raceId | number | 판마다 1씩 증가(첫 판 1). 이전 판 지연 메시지 폐기 기준 |
| players | Map<playerId, Player> | 최대 15 (FR-004) |
| raceStartedAt | number \| null | 호스트 로컬 performance 기준 |

**상태 전이**:

```
lobby ──(호스트 시작, 참가자≥2)──▶ countdown ──(3초)──▶ race ──(30초 경과 or 전원 확정)──▶ result
  ▲                                                                                        │
  └────────────────────────────(호스트 "다시 하기" — 멤버 유지, 기록 초기화)◀──────────────────┘
```

- 신규 입장은 `lobby`에서만 허용(FR-020). 재접속(playerId 일치)은 모든 phase에서 허용(FR-026).

## Player (참가자)

| 필드 | 타입 | 규칙 |
|---|---|---|
| playerId | string(uuid) | 폰이 생성해 localStorage 보관(닉네임도 함께 저장 — 재접속 폼 프리필). 재접속 승계 키 |
| nickname | string | 입력 1~10자, 공백만은 거부. 방 내 중복 시 " (2)" 접미사 — 접미사는 10자 제한과 별도(표시 최대 14자) |
| connected | boolean | DataConnection 생존 여부. 로비 표시용(FR-005) |
| race | PlayerRaceState \| null | 레이스 중에만 존재 |

## PlayerRaceState (레이스 상태) — 판정은 플레이어 로컬(FR-013)

| 필드 | 타입 | 규칙 |
|---|---|---|
| distance | number | 0 이상 단조 증가. 단위: 보(step) 환산 거리 |
| tilt | number | 원시값(클램프하지 않음). `abs(tilt) >= TILT_LIMIT(100)` 되는 순간 넘어짐(FR-011). 게이지 표시만 ±100로 클램프 |
| fallen | boolean | true가 되면 이후 입력 무시, 기록 확정 |
| distanceReachedAt | number \| null | 현재 distance에 도달한 시각(레이스 시작 기준 경과 ms) = 마지막 전진 탭 시각. **동점 타이브레이크 값(FR-021)** — 호스트로 전송됨 |
| finishedAt | number \| null | 기록 확정 시각(넘어짐 또는 30초 완주). 표기·연출용 |
| seq | number | 판 내 스냅샷 단조 증가 번호. 수신 측 오래된 스냅샷 폐기용 |
| lastSide | `'L' \| 'R' \| null` | 직전 입력 방향(로컬 전용, 미전송) |
| lastTapAt | number \| null | 직전 입력 시각(드리프트·연타 무시 계산용, 로컬 전용) |

**동점 규칙(FR-021)**: distance 내림차순 → 동일하면 `distanceReachedAt` 오름차순
(그 거리에 먼저 도달한 쪽 상위). 완주자도 마지막 전진 시각으로 비교되므로 30초
완주끼리도 판별된다.

## RaceResult (기록)

| 필드 | 타입 | 규칙 |
|---|---|---|
| playerId / nickname | string | |
| distance | number | 최종 확정 거리 |
| fallen | boolean | 넘어짐 여부(연출·표기용) |
| rank | number | 1부터. FR-021 타이브레이크 적용 후 유일 |

## 밸런스 상수 (`src/game/balance.ts` — 단일 출처)

| 상수 | 초기값 | 근거(spec) |
|---|---|---|
| RACE_DURATION_MS | 30000 | FR-012 |
| TILT_LIMIT | 100 | FR-011 |
| STEP_DISTANCE | 1 | 교대 성공 1보 전진(FR-008) |
| TILT_RECOVER_PER_STEP | 8 | 교대 성공 시 회복(FR-008) |
| TILT_PENALTY_SAME_SIDE | 35 | 같은 쪽 연속(FR-009) — 3연속이면 사실상 넘어짐 |
| DRIFT_PER_SEC | 25 | 입력 공백 시 초당 기울기 증가(FR-010), 방향은 시작 시 랜덤 후 유지 |
| DRIFT_GRACE_MS | 700 | 이 시간 안에 다음 탭이 오면 드리프트 없음(박자 유지 판정) |
| MIN_TAP_INTERVAL_MS | 60 | 이보다 빠른 입력 무시(엣지 케이스: 비정상 연타) |
| STATE_SEND_HZ | 10 | R3 |
| MAX_PLAYERS | 15 | FR-004 |
| COUNTDOWN_MS | 3000 | US2-AS1 |

초기값은 프로토타입 기준이며 플레이테스트로 조정한다 — 조정은 이 파일과
`balance.ts`에서만 일어난다(스펙의 ±100·30초·15명은 고정 요구).

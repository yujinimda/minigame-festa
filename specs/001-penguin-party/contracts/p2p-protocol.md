# Contract: 호스트 ↔ 플레이어 P2P 메시지 프로토콜 v1

`src/p2p/protocol.ts`의 타입 정의와 이 문서는 1:1로 유지한다(불일치 = 버그).

## 채널 구성 (플레이어당 2개 DataConnection)

| 채널 | PeerJS 옵션 | 용도 |
|---|---|---|
| **control** | `{ reliable: true }` (ordered) | join/joined/roster/race-start/race-end/fall/finish/heartbeat 등 모든 제어·이벤트 |
| **state** | `{ reliable: false }` (unordered, 재전송 없음) | 레이스 중 10Hz 상태 스냅샷 전용 |

- state 채널이 열리지 않는 환경(협상 실패)에서는 control 채널로 폴백하되,
  송신 전 `dataChannel.bufferedAmount > 16KB`면 해당 틱 스냅샷을 건너뛴다(합침 효과).
- 수신 측은 `(raceId, seq)`로 오래된 스냅샷을 폐기한다: 저장된 최대 seq 이하이거나
  현재 raceId와 다르면 무시.

## 공통 필드

모든 메시지: `{ v: 1, type: string }`. 알 수 없는 `type`은 무시(전방 호환).
레이스에 종속된 메시지(`state`·`fall`·`finish`·`race-start`·`race-end`)는 `raceId`(판마다
증가하는 정수, 호스트 발급) 필수 — 이전 판의 지연 메시지가 다음 판을 오염시키지 않게 한다.

## 플레이어 → 호스트

| type | 채널 | payload | 시점/규칙 |
|---|---|---|---|
| `join` | control | `{ playerId, nickname? }` | 연결 직후 1회. 재접속(호스트에 같은 playerId 존재)이면 `nickname` 생략 가능 — 호스트가 기존 값 복원. 신규인데 nickname이 없거나 유효하지 않으면 `join-rejected(invalid-nickname)` |
| `heartbeat` | control | `{}` | 2초 간격. 호스트는 마지막 수신(모든 메시지 포함) 후 6초 무소식이면 `connected: false` 처리 — close 이벤트 단독 의존 금지(iOS Safari 이벤트 누락 대비) |
| `state` | state | `{ raceId, seq, distance, tilt, fallen, distanceReachedAt }` | 레이스 중 10Hz. `seq`는 판 내 단조 증가. `distanceReachedAt`은 현재 distance에 도달한 시각(레이스 시작 기준 경과 ms) |
| `fall` | control | `{ raceId, distance, distanceReachedAt, finishedAt }` | 넘어짐 순간 1회. 연출 트리거 + 기록 확정 |
| `finish` | control | `{ raceId, distance, distanceReachedAt, finishedAt }` | 30초 로컬 타이머 종료 시 1회(생존 완주) |

## 호스트 → 플레이어

| type | 채널 | payload | 시점/규칙 |
|---|---|---|---|
| `joined` | control | `{ playerId, nickname, resumed, snapshot }` | join 수락. `nickname`은 중복 접미사 반영 확정값. `snapshot`(아래)으로 어느 phase에서 재접속해도 UI 복원 가능 |
| `join-rejected` | control | `{ reason: 'room-full' \| 'race-in-progress' \| 'invalid-nickname' }` | FR-004 · FR-020 · FR-003 |
| `roster` | control | `{ players: [{playerId, nickname, connected}] }` | 로비에서 변동 시 브로드캐스트(FR-005) |
| `race-start` | control | `{ raceId, countdownMs, durationMs }` | 시작 브로드캐스트. 플레이어는 수신 시점 기준 로컬 타이머(R4) |
| `race-end` | control | `{ raceId, results: [{playerId, nickname, distance, fallen, rank}] }` | 호스트 마감 후 브로드캐스트. 각 폰은 자기 rank 강조(FR-015) |
| `return-lobby` | control | `{}` | "다시 하기"(FR-017). 폰은 대기 화면으로 |
| `room-closed` | control | `{}` | 호스트 정상 종료 시(가능한 경우). 연결 끊김+하트비트 타임아웃만으로도 동일 처리 |

### RoomSnapshot (`joined.snapshot`)

```
{
  phase: 'lobby' | 'countdown' | 'race' | 'result',
  raceId: number | null,
  remainingMs: number | null,      // countdown/race일 때 남은 시간(호스트 기준)
  roster: [{playerId, nickname, connected}],
  ownRecord: { distance, fallen, finishedAt } | null,   // 재접속자의 확정 기록(있으면)
  results: RaceResult[] | null     // phase가 result일 때
}
```

## 연결 수명 규칙

- **연결 세대**: 같은 `playerId`의 새 control 연결이 열리면 호스트는 이전 연결을
  닫고 새 연결을 정본으로 삼는다(최신 연결 승리). 플레이어 재접속은 1s→2s→4s(최대
  10s) 백오프로 자동 재시도한다.
- **재접속(FR-026)**: 같은 `playerId` join → 기존 슬롯 재바인딩, `resumed: true`,
  `snapshot`으로 화면 복원. 레이스 중 미확정이었다면 끊김 시점 상태로 이미 확정됨(FR-019).
- **정원(FR-004)**: 재접속은 신규로 세지 않는다.
- **끊김 판정(FR-019)**: control close/error **또는** 하트비트 6초 타임아웃 중 먼저
  온 것. 레이스 중이면 마지막 수신 state의 `distance`/`distanceReachedAt`으로 기록
  확정, `fallen: false` 유지.
- **호스트 소멸**: 플레이어는 close 또는 하트비트 응답 부재 시 "방이 종료됨" 표시.

## 동점 판정 입력 (FR-021)

호스트는 순위 집계 시 `distance` 내림차순 → 동일하면 `distanceReachedAt` 오름차순.
`finishedAt`은 표기·연출용이지 타이브레이크 값이 아니다.

## 검증 시나리오 매핑

| 계약 항목 | spec 근거 |
|---|---|
| join/joined/roster/snapshot | US1 AS1-2, FR-003·005, Edge(재접속) |
| join-rejected(room-full) | US1 AS3, FR-004 |
| join-rejected(race-in-progress) | Edge(중도 입장), FR-020 |
| race-start/state(seq)/fall | US2 AS1-5, FR-007~014 |
| finish/race-end/rank/distanceReachedAt | US2 AS6, US3 AS1-3, FR-015·021 |
| return-lobby/raceId 오염 방지 | US3 AS4, FR-017 |
| heartbeat/연결 세대/백오프 | FR-005·019·026 |

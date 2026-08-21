# Contract: 호스트 ↔ 플레이어 P2P 메시지 프로토콜 v1

전송로: PeerJS DataConnection (reliable, ordered, JSON 직렬화).
`src/p2p/protocol.ts`의 타입 정의와 이 문서는 1:1로 유지한다(불일치 = 버그).

모든 메시지 공통 필드: `{ v: 1, type: string }`. 알 수 없는 `type`은 무시(전방 호환).

## 플레이어 → 호스트

| type | payload | 시점/규칙 |
|---|---|---|
| `join` | `{ playerId, nickname }` | 연결 직후 1회. 호스트는 `joined` 또는 `join-rejected`로 응답 |
| `state` | `{ distance, tilt, fallen, finishedAt }` | 레이스 중 10Hz. 넘어짐 후에는 전송 중단(마지막 1회 보장은 `fall`이 담당) |
| `fall` | `{ distance, finishedAt }` | 넘어짐 순간 1회(이벤트). 연출 트리거 |
| `finish` | `{ distance, finishedAt }` | 30초 로컬 타이머 종료 시 1회(생존 완주) |

## 호스트 → 플레이어

| type | payload | 시점/규칙 |
|---|---|---|
| `joined` | `{ playerId, nickname, roster, phase, resumed }` | join 수락. `nickname`은 중복 접미사 반영된 확정값. `resumed: true`면 재접속 승계(FR-026) |
| `join-rejected` | `{ reason: 'room-full' \| 'race-in-progress' \| 'invalid-nickname' }` | FR-004 · FR-020 · FR-003 |
| `roster` | `{ players: [{playerId, nickname, connected}] }` | 로비에서 변동 시 브로드캐스트(FR-005) |
| `race-start` | `{ countdownMs, durationMs }` | 시작 브로드캐스트. 플레이어는 수신 시점 기준 로컬 타이머(R4) |
| `race-end` | `{ results: [{playerId, nickname, distance, fallen, rank}] }` | 호스트 마감 후 브로드캐스트. 각 폰은 자기 rank 강조 표시(FR-015) |
| `return-lobby` | `{}` | "다시 하기"(FR-017). 폰은 대기 화면으로 |
| `room-closed` | `{}` | 호스트가 정상 종료 시(가능한 경우). 연결 끊김만으로도 동일 처리 |

## 연결 수명 규칙

- **재접속(FR-026)**: 같은 `playerId`로 `join`이 오면 기존 슬롯에 재바인딩하고
  `resumed: true`. 레이스 중이면 확정된 기록 유지, 미확정이면 끊김 시점 상태로 확정(FR-019).
- **정원(FR-004)**: 재접속은 정원 계산에서 신규로 세지 않는다.
- **끊김(FR-019)**: 레이스 중 DataConnection close/error 시 호스트가 마지막 수신
  `state`의 distance로 기록 확정, `fallen`은 false 유지(끊김이지 넘어짐이 아님).
- **호스트 소멸**: 플레이어는 연결 close 감지 시 "방이 종료됨" 화면 표시.

## 검증 시나리오 매핑

| 계약 항목 | spec 근거 |
|---|---|
| join/joined/roster | US1 AS1-2, FR-003·005 |
| join-rejected(room-full) | US1 AS3, FR-004 |
| join-rejected(race-in-progress) | Edge(중도 입장), FR-020 |
| race-start/state/fall | US2 AS1-5, FR-007~014 |
| finish/race-end/rank | US2 AS6, US3 AS1-3, FR-015·021 |
| return-lobby | US3 AS4, FR-017 |
| 재접속 resumed | Edge(재접속), FR-026 |

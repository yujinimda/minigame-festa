# 게이트8 리뷰 — Foundation 1회차 (Opus 4.6, 2026-08-21)

**VERDICT: BLOCKED** — 재개 시 B1~B9 수정 후 재검증(핑퐁 2회차) 필요. 전부 PeerJS 배선부(단위 테스트 미커버 영역).

## BLOCKED

- **B1** `src/p2p/host-room.ts` bindConnection — 연결 세대 교체 순서 반대. peerjs 1.5의 `close()`는 동기 emit이라 `prev.close()` 시점에 아직 `connections.get(playerId)===prev` → prev의 close 핸들러가 `markDisconnected`를 먼저 실행 → 재접속인데 기록 조기 확정. `connections.set`을 먼저 하거나 close 핸들러에 세대 토큰.
- **B2** `src/p2p/player-client.ts` — 재접속 타이머 폭주/누수. close+error 이중 `scheduleReconnect`, 하트비트가 닫힌 conn에 send → 동기 error → 2초마다 추가 스케줄. `scheduleReconnect`가 기존 타이머 clear 안 함 → pending 누적, destroy는 마지막 하나만 clear. 백오프 무의미.
- **B3** 접속 10s 타임아웃이 destroy에서 clear 안 되고 콜백에 destroyed 가드 없음 → 재입장 시 구 클라이언트 타임아웃이 새 세션을 connect-failed로 튕김.
- **B4** `usePlayerSession` — 언마운트 시 destroy 경로 없음 → 페이지 떠나도 하트비트 지속, 호스트에 유령 connected + 정원 점유. `useEffect(() => () => clientRef.current?.destroy(), [])` 필요.
- **B5** snapshot `remainingMs` 의미 불일치 — 호스트는 countdown일 때 카운트다운 잔여만, 플레이어는 전체 잔여로 역산 → countdown 중 재접속하면 즉시 racing+2초 뒤 finish. 호스트가 전체 잔여로 통일하거나 플레이어 역산 분기.
- **B6** `markHostSeen`이 reconnecting→joined로 무조건 복귀 — 레이스 중이면 phase 맞는 상태(racing 등)로 복귀해야 함. 아니면 state/finish 송신 영구 중단.
- **B7** `heartbeat-ack.hostT`가 방 상대시각(코어 now) — 계약은 벽시계(시계 오프셋 추정용). ack에는 `Date.now()` 실어야.
- **B8** 넘어짐 순간 status=finished → 셸이 즉시 PersonalResult로 전환 → US2 컨트롤러의 넘어짐 피드백(FR-025)이 렌더 불가 + results 아직 null. race-end 전 finished는 컨트롤러 유지(전용 fallen 상태). **셸은 F 소유라 F에서 고쳐야 함.**
- **B9** 100ms 티커가 무조건 onChange + syncRoom이 매번 새 배열 set + 셸이 셀렉터 없이 전체 구독 → 호스트 트리 10Hz 리렌더(Phaser 컨테이너 포함, R6 결정 무효화). 변경 감지 후 set 또는 tick/onChange 분리.

## NOTE (차단 아님 — 수정 시 같이 고려)

- finishedAt 시간 기준이 경로별로 상이(endRace=방 상대 / markDisconnected=레이스 경과 / fall·finish=플레이어 상대) — 표기용이지만 통일 권장
- 거부된 참가자 conn 미정리(브로드캐스트 계속 수신, 플레이어도 onRejected 후 destroy 안 함)
- 로비에서 끊긴 슬롯 영구 점유 — 미복귀 시 회수 검토
- FR-006(2명 이상)이 core.startRace()에 없음 — 권위 로직 원칙 위반
- 호스트 peer.on("disconnected") 재연결 없음 — 시그널링 1회 단절 시 신규 입장 영구 불가
- 호스트 오디오 언락 경로 없음(unlockAudio가 플레이어 쪽만) + host-store에 muted 미러 없음
- usePlayerSession이 매 렌더 새 객체 반환([session] 이펙트 재실행), playerId/자기 기록 미노출
- 셸이 idle/joined/reconnecting을 전부 Controller로 라우팅 — 대기/재접속 UI 소유 명확화 필요. race-start 때 이전 results 미초기화
- parseMessage payload shape 미검증 — 최소 shape 검사 권장

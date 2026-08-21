# 게이트8 리뷰 — Foundation 2회차 (Opus 4.6, 2026-08-21)

**VERDICT: APPROVED** — B1~B9 해소 확인, 신규 차단급 결함 없음. 게이트 종료.

리뷰어 NOTE 중 후속 반영분(머지 전 커밋):
- markHostSeen 분기 1순위를 `results !== null → "result"`로 (result 화면 이탈 방지)
- tick에서 reconnecting 진입 시 scheduleReconnect 동시 호출 (close 이벤트 누락 환경 대응)
- usePlayerSession join의 await 중 언마운트 가드(mountedRef)
- 호스트 `countdownRemainingMs()` 헬퍼 추가 (raceRemainingMs 오용 방지, US2 사용)
- 거부 conn 지연 close 타이머를 destroy에서 정리 + destroy의 room-closed도 flush 여유(300ms) 후 정리로 통일
- 셸이 status=closed에서 세션 destroy (잔여 인터벌 정리)

미반영 NOTE(후속 검토): unavailable-id 재발급 경로의 disconnected 핸들러 상호작용(빈도 낮음 — 재발급 플래그 도입 검토).

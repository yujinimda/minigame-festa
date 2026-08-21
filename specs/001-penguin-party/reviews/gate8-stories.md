# 게이트8 리뷰 — 스토리 3건 (Opus 4.6, 2026-08-21)

## US1 (PR #2) — 1회차 APPROVED

NOTE 반영: 닉네임 상태 승격(재시도 죽은 버튼 해소, 폼 제출로 통합), form submit/enterKeyHint,
MAX_PLAYERS 보간, 시작 인원 connected 필터(UI).
F 에스컬레이션 → 별도 패치(PR #5·#6·#7): crypto.randomUUID insecure context 폴백,
방 코드 수동 입력 화면(R7 갭), startRace 판정(connected 기준은 T009 계약과 충돌해 size 기준 유지).

## US2 (PR #3) — 1회차 BLOCKED 1건 → 2회차 APPROVED

- B1: 레이스 시작 폰 피드백 부재(FR-025) → countdown→racing 전환에 start SFX+진동+
  "출발!!" 배너 1.2s (전환에서만 — 재접속 복귀 재발화 방지)
- F 에스컬레이션(PR #7): **완주 finish가 distance 0 송신** — core.updateProgress 신설로
  순위 오염 경로 차단
- NOTE 반영: 카운트다운 3·2·1 SFX(FR-024), Phaser 청크 프리페치(+catch), 레이스 중
  재합류 시 판정 상태 리마운트(freshEntry), MIN_GOAL 근거 주석
- 미반영 NOTE(후속): reconnecting 구간 드리프트 면제, 재접속 finished 시 "0보 완주" 표시
  (호스트 results는 정상 — 표시만), 파티클 이미터 잔존(씬 파괴로 회수됨)

## US3 (PR #4) — 1회차 APPROVED

NOTE 반영: 등수 셀 w-24·tabular-nums, 꽈당 배지를 truncate 밖으로.
미반영 NOTE(후속): 15인 순위 화면 밀도(T030 룩앤필 패스), PersonalResult의 nickname 매칭
(호스트 유일화 불변식에 의존 — F에 playerId 노출 검토), 1등 강조 테스트 판정식 항진성,
연타 멱등 테스트 부재(코어 가드는 존재).

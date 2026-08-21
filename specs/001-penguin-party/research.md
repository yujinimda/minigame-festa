# Research: 펭귄 빙판 걷기 (Phase 0)

기술 미확정 항목을 조사·확정한다. 형식: Decision / Rationale / Alternatives considered.

## R1. P2P 라이브러리와 방 식별

- **Decision**: peerjs ^1.5 + 공식 클라우드 PeerServer(무료). 호스트가
  `Peer("mgf-" + 6자리 코드)`로 자기 ID를 방 코드로 삼고, 플레이어는
  `peer.connect(hostId)`의 DataConnection(reliable·ordered)으로 직접 연결.
- **Rationale**: 시그널링 서버를 직접 운영하지 않아 비용 0원(FR-018). 15개
  DataConnection은 호스트 브라우저가 충분히 감당. ID를 곧 방 코드로 쓰면
  별도 방 레지스트리가 필요 없다. 접두사 `mgf-`로 타 서비스 ID와 충돌 회피.
- **Alternatives considered**: 원시 WebRTC + 수제 시그널링(무료 서버 필요 — 탈락),
  Colyseus(서버 필요 — 탈락), Supabase Realtime(지연·서버 의존 — 설계 단계에서 기각).

## R2. Next.js 배포 형태와 라우팅

- **Decision**: 표준 Vercel 배포(무료 Hobby), App Router. `/play/[roomId]`는
  동적 세그먼트를 그대로 쓰되 페이지 전체를 클라이언트 컴포넌트로 구성.
  API 라우트·서버 액션·DB는 만들지 않는다.
- **Rationale**: QR에 담기는 URL이 `/play/abc123` 형태로 깔끔. static export로
  강제하면 동적 세그먼트 처리가 번거로운데, Vercel Hobby 무료 범위에서 표준
  배포로도 서버 코드 0인 상태를 유지할 수 있어 FR-018 충족.
- **Alternatives considered**: `output: 'export'` + `/play?room=` 쿼리(URL이 지저분,
  득이 없음), GitHub Pages(프리뷰 배포·도메인 편의성에서 Vercel이 우위).

## R3. 상태 전송 주기와 메시지 설계

- **Decision**: 플레이어 → 호스트 상태 스냅샷 10Hz(100ms 간격) + 이벤트(넘어짐·입장·퇴장)는
  즉시 전송. 호스트는 수신 상태를 보간 없이 최근값 렌더(60fps rAF 루프에서 CSS transform).
- **Rationale**: SC-002(≤0.5s 반영)에 10Hz + WebRTC 지연(수십 ms)이면 충분한 여유.
  15명 × 10Hz × 작은 JSON은 대역폭·GC 부담이 무시 가능한 수준. 넘어짐 같은
  단발 이벤트를 스냅샷에 실으면 유실 시 연출을 놓치므로 별도 이벤트로 분리.
- **Alternatives considered**: 탭 원본 전송 + 호스트 판정(FR-013 위배, 지연 민감),
  30~60Hz 전송(이득 없이 부하만 증가), 보간 렌더(단순 최근값으로 SC-002 충족 — YAGNI).

## R4. 시간 동기화 (레이스 시작·종료)

- **Decision**: 호스트가 `race-start` 메시지에 `countdownMs`(예: 3000)와
  `durationMs`(30000)를 실어 보내고, 각 플레이어는 **수신 시점 기준**으로 로컬
  카운트다운·타이머를 돌린다. 종료 판정은 플레이어 로컬(30초 경과 시 최종 상태
  전송) + 호스트도 자체 타이머로 마감(유실 대비 race-end 시 마지막 수신값 사용).
- **Rationale**: 벽시계 동기화(NTP류) 없이도 연결별 지연 편차는 수십 ms 수준이라
  파티게임 공정성에 무해. 이중 마감으로 끊긴 플레이어(FR-019)도 자연 처리.
- **Alternatives considered**: 호스트 절대 타임스탬프 공유(기기 간 시계 오차가
  오히려 더 큼), ping 왕복 보정(복잡도 대비 이득 없음).

## R5. 진동·사운드 (FR-024·FR-025)

- **Decision**: 진동은 `navigator.vibrate` 사용하되 **iOS Safari는 미지원이므로
  기능 감지 후 시각 플래시 + 효과음으로 폴백**. 사운드는 Web Audio API 직접 사용
  (라이브러리 없음), 짧은 효과음은 사전 디코드한 AudioBuffer 재생. 닉네임 입장
  버튼 탭(사용자 제스처)에서 AudioContext를 resume해 모바일 자동재생 제약 해제.
  호스트 BGM은 `<audio loop>` + 게임 시작 버튼 제스처로 시작.
- **Rationale**: iPhone 13(기준 기기)이 Vibration API를 지원하지 않는 것이 확인된
  플랫폼 제약 — 스펙의 "진동" 요구는 안드로이드에서 충족, iOS는 폴백으로 대체하고
  이 예외를 스펙 Assumptions에 반영하지 않고 구현 노트로 남긴다(사용자 보고 시 명시).
  Web Audio는 지연이 낮아 탭 피드백에 적합.
- **Alternatives considered**: howler.js(의존성 추가 대비 이득 적음), iOS 햅틱을
  위한 네이티브 래퍼(웹 범위 밖 — 기각).

## R6. 상태 관리·게임 루프

- **Decision**: zustand로 화면 상태 머신(lobby→race→result)과 로스터를 관리.
  고빈도 값(기울기·거리)은 React 상태를 거치지 않고 ref + rAF로 직접 DOM/CSS
  transform 갱신(리렌더 폭풍 방지). 판정 로직은 `src/game/penguin.ts` 순수 함수
  (`applyTap(state, side, now)`, `applyDrift(state, dt)`)로 두고 어느 쪽에서도 재사용.
- **Rationale**: 15개 펭귄 × 10Hz 갱신을 React 리렌더로 처리하면 60fps가 흔들릴
  수 있다. 순수 함수 분리는 워크플로우의 역할 역전 테스트(코덱스 작성)가 UI 없이
  규칙을 검증하는 전제 조건.
- **Alternatives considered**: Jotai(회사 컨벤션이지만 개인 프로젝트 소규모 상태에
  zustand가 더 단순), PixiJS/canvas(15 스프라이트는 DOM transform으로 충분 — YAGNI).

## R7. QR 코드

- **Decision**: `qrcode.react`(SVG 렌더)로 호스트 화면에 참가 URL
  (`{origin}/play/{roomId}`) 표시. 방 코드 텍스트도 병기(카메라 안 되는 경우 수동 입력).
- **Rationale**: 클라이언트 렌더 한 줄로 끝나는 검증된 라이브러리. 외부 QR API
  호출(무료지만 외부 의존·오프라인 취약)보다 자급자족.
- **Alternatives considered**: `qrcode`(canvas — SVG 대비 이점 없음), 외부 이미지 API(기각).

## R8. 테스트 전략

- **Decision**: Vitest — `src/game/penguin.ts`(교대 전진·연속 페널티·드리프트·넘어짐
  임계·동점 타임스탬프), `src/p2p/protocol.ts`(메시지 인코딩/버전), 로스터 규칙
  (정원 15·중복 닉네임 접미사·재접속 승계)을 단위 테스트. Playwright — 데스크톱
  컨텍스트(호스트) + 모바일 뷰포트 컨텍스트(플레이어 2명)로 로비 입장→레이스→결과
  스모크 1본(실 PeerJS 연결, 로컬에서 same-origin).
- **Rationale**: 규칙·프로토콜·로스터가 버그 밀도가 높은 곳이고 순수 로직이라
  테스트 비용이 낮다. E2E는 P2P 배선이 실제로 붙는지 1본이면 회귀 감지에 충분.
- **Alternatives considered**: Peer 목킹 E2E(배선 검증이 목적이라 실 연결 유지),
  전 화면 스냅샷 테스트(파티게임 연출 변경이 잦아 유지비 과다 — 기각).

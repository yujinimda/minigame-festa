# Research: 펭귄 빙판 걷기 (Phase 0)

기술 미확정 항목을 조사·확정한다. 형식: Decision / Rationale / Alternatives considered.

## R1. P2P 라이브러리와 방 식별

- **Decision**: peerjs ^1.5 + 공식 클라우드 PeerServer(무료). 호스트가
  `Peer("mgf-" + 6자리 코드)`로 자기 ID를 방 코드로 삼고, 플레이어는 채널 2개
  (control: reliable / state: unreliable — 계약 문서 참조)로 직접 연결.
- **Rationale**: 시그널링 서버를 직접 운영하지 않아 비용 0원(FR-018). ID를 곧
  방 코드로 쓰면 별도 방 레지스트리가 필요 없다. 접두사 `mgf-`로 타 서비스 ID와
  충돌 확률을 낮추고, 그래도 충돌하면(`unavailable-id` 에러) 코드를 재발급한다.
- **알려진 리스크와 대응** (PeerJS Cloud는 공유 인프라):
  - *ID 충돌*: `unavailable-id` 수신 시 새 코드로 자동 재생성 (구현 필수)
  - *시그널링 장애/연결 타임아웃*: 플레이어 접속 10초 타임아웃 → 오류 안내 +
    "다시 시도" 버튼. 호스트도 Peer open 실패 시 재시도 UI
  - *ICE 실패(symmetric NAT)*: 기본 구성은 STUN만 — 모바일 데이터 일부 환경에서
    연결 실패 가능. 참가 화면에 "잘 안 되면 호스트와 같은 Wi-Fi로" 안내 문구
  - *연결 수*: PeerJS FAQ는 peer당 실용 연결 수를 5~10으로 안내. 본 프로젝트는
    저대역 텍스트만 오가므로 초과 가능성이 높지만 **검증 전 가정** — 구현 후
    15인 go/no-go 플레이테스트를 배포 게이트로 둔다(quickstart §플레이테스트 —
    연결 수 상한과 네트워크 혼합을 분리 검증). 실패 시 결정지: ① 스펙을 "같은
    Wi-Fi 권장, 정원 축소"로 완화(스펙 개정) ② 셀프호스트 PeerServer 도입 —
    이는 시그널링 서버 운영이므로 **FR-018 문구 개정이 전제**다(비용 0원은 무료
    티어로 유지 가능하나 "백엔드 서버 없이"는 "게임 상태 서버 없이"로 완화 필요)
- **Alternatives considered**: 원시 WebRTC + 수제 시그널링(무료 서버 필요 — 탈락),
  Colyseus(서버 필요 — 탈락), Supabase Realtime(지연·서버 의존 — 설계 단계에서 기각).

## R2. Next.js 배포 형태와 라우팅

- **Decision**: Next.js `output: 'export'`(완전 정적 export) + Vercel 무료 배포.
  참가 경로는 `/play?room={roomId}` 쿼리 방식(클라이언트에서 useSearchParams로
  파싱, Suspense 경계 포함). API 라우트·서버 액션·DB 없음.
- **Rationale**: 동적 세그먼트 `[roomId]`는 static export에서 지원되지 않으므로,
  FR-018의 "정적 호스팅"을 문자 그대로 지키려면 쿼리 방식이 맞다. URL은 QR에
  담겨 사람이 손으로 치지 않으므로 미관 손실이 실익에 영향 없음(codex B3 반영).
  정적 export는 배포 대상을 어떤 정적 호스트로도 옮길 수 있게 한다.
- **Alternatives considered**: 표준 Vercel 배포 + `/play/[roomId]`(서버 코드는
  없지만 "정적 호스팅" 요구와 어긋남 — 기각), hash 라우팅 `#room=`(쿼리로 충분),
  Vite SPA(스택 단순화 이점은 있으나 Vercel 프리뷰·기존 숙련도 기준 Next 유지).

## R3. 상태 전송 주기와 메시지 설계

- **Decision**: 채널 분리 — 제어·이벤트는 reliable control 채널, 상태 스냅샷
  10Hz는 **unreliable state 채널**(`{reliable: false}`, 재전송 없음)로 전송.
  스냅샷은 `(raceId, seq)`를 달고, 수신 측은 오래된 seq·다른 raceId를 폐기.
  state 채널 미개통 시 control로 폴백하되 `bufferedAmount > 16KB`면 그 틱을
  건너뛴다(중간 스냅샷 합침). 호스트는 최근값을 60fps rAF에서 CSS transform 렌더.
- **Rationale**: reliable·ordered 단일 채널은 패킷 손실 시 재전송 대기(head-of-line
  blocking)로 오래된 상태가 밀려 SC-002(0.5s)를 위협한다(codex B5 반영). 상태는
  최신값만 의미 있으므로 유실 허용이 맞고, 넘어짐 같은 단발 이벤트는 유실되면
  안 되므로 reliable 채널에 남긴다. `raceId`는 "다시 하기" 후 이전 판 지연
  메시지 오염 방지(codex B1).
- **계측**: 15인 플레이테스트에서 입력→호스트 반영 지연 p95를 스냅샷 타임스탬프로
  측정해 SC-002를 수치로 확인한다(quickstart §플레이테스트).
- **Alternatives considered**: 탭 원본 전송 + 호스트 판정(FR-013 위배, 지연 민감),
  reliable 단일 채널 + 큐 감시만(HOL blocking 잔존 — 기각), 30~60Hz(이득 없음),
  보간 렌더(최근값으로 충분 — YAGNI).

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
  플랫폼 제약. 이 폴백은 스펙 FR-025에 명시적으로 반영했다(codex B6) — "진동은
  지원 기기에서, 미지원 기기(iOS Safari)는 시각 플래시+효과음 폴백 허용".
  Web Audio는 지연이 낮아 탭 피드백에 적합. 오디오 언락 성공/실패는 UI에 표시
  (음소거 아이콘)하고, 실기기 검증 체크리스트를 quickstart에 둔다.
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
  (`{origin}/play?room={roomId}` — R2의 정적 라우팅 결정과 동일) 표시.
  방 코드 텍스트도 병기(카메라 안 되는 경우 수동 입력).
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

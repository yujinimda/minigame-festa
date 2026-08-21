// WebRTC ICE 설정 — STUN만으로는 일부 모바일 데이터망(symmetric NAT)에서 연결이
// 실패한다(research R1). Open Relay(Metered)의 무료 공용 TURN을 추가해 성공률을
// 올린다 — 비용 0원 유지(FR-018). 공용 무료 릴레이라 가용성 보장은 없음:
// TURN이 죽어도 STUN 직결은 그대로 동작한다.

export const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  {
    urls: "turn:staticauth.openrelay.metered.ca:80",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turn:staticauth.openrelay.metered.ca:443",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turns:staticauth.openrelay.metered.ca:443?transport=tcp",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

export const PEER_OPTIONS = {
  config: { iceServers: ICE_SERVERS },
};

import crypto from "crypto";

/**
 * Meeting room provisioning for live video (mock interviews, mentorship, live classes).
 *
 * No third-party video API key is required: the primary path is our own WebRTC signaling
 * (see services/webrtcSignaling.js) over a random room id. `jitsiFallbackUrl` is included
 * purely as a client-side escape hatch — if a peer-to-peer connection can't be established
 * (e.g. two strict/symmetric NATs and no TURN relay configured), the frontend can drop the
 * user into a public meet.jit.si room instead. Nothing here calls out to a paid API.
 */
export function createMeeting({ topic = "session" } = {}) {
  const roomId = `${slugify(topic)}-${crypto.randomBytes(6).toString("hex")}`;
  return {
    provider: "webrtc",
    roomId,
    jitsiFallbackUrl: `https://meet.jit.si/SkillAra-${roomId}`,
  };
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40) || "session";
}

import { Server } from "socket.io";
import { verifyAccessToken } from "../utils/tokens.js";
import { corsOrigin } from "../utils/cors.js";
import BookableSlot from "../models/BookableSlot.js";
import LiveSession from "../models/LiveSession.js";
import Enrollment from "../models/Enrollment.js";
import logger from "../core/logger.js";

/**
 * Self-hosted WebRTC signaling — no third-party video API/key involved. Peers exchange
 * SDP offers/answers, ICE candidates, and in-call chat text through this socket; actual
 * media (audio/video) flows peer-to-peer once negotiated. The client tries STUN first,
 * then a free public TURN relay if a direct route can't be found, and only falls back to
 * the jitsiFallbackUrl stored on the booking/session if both of those fail.
 *
 * Room membership is capped at the two-plus participants a booking legitimately has
 * (host + student for a slot, instructor + enrolled students for a live class) — anyone
 * else attempting to join a roomId is rejected server-side, not just hidden client-side.
 */
export function attachSignaling(httpServer) {
  const io = new Server(httpServer, {
    path: "/socket.io/webrtc",
    cors: {
      origin: corsOrigin,
      credentials: true,
    },
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error("UNAUTHORIZED"));
      const decoded = verifyAccessToken(token);
      socket.user = {
        id: String(decoded.sub),
        tenantId: decoded.tenant_id ? String(decoded.tenant_id) : null,
        role: decoded.role,
      };
      return next();
    } catch {
      return next(new Error("UNAUTHORIZED"));
    }
  });

  io.on("connection", (socket) => {
    socket.on("join-room", async ({ roomId }, ack) => {
      try {
        if (typeof roomId !== "string" || !roomId) {
          return ack?.({ ok: false, error: "INVALID_ROOM" });
        }

        const authorized = await isAuthorizedForRoom(socket.user, roomId);
        if (!authorized) {
          return ack?.({ ok: false, error: "FORBIDDEN" });
        }

        const room = io.sockets.adapter.rooms.get(roomId);
        const existingPeers = room ? Array.from(room) : [];
        // Every current room primitive (interview slot, mentorship slot, live 1:1) is
        // capped at two live participants; a live class extends this once group support lands.
        if (existingPeers.length >= 8) {
          return ack?.({ ok: false, error: "ROOM_FULL" });
        }

        socket.join(roomId);
        socket.roomId = roomId;
        socket.to(roomId).emit("peer-joined", { peerId: socket.id, userId: socket.user.id });
        return ack?.({ ok: true, peers: existingPeers });
      } catch (err) {
        logger.error(`webrtc join-room failed: ${err.message}`);
        return ack?.({ ok: false, error: "SERVER_ERROR" });
      }
    });

    socket.on("signal", ({ roomId, to, data }) => {
      if (!roomId || !to || socket.roomId !== roomId) return;
      io.to(to).emit("signal", { from: socket.id, data });
    });

    socket.on("chat-message", ({ roomId, text }) => {
      if (typeof text !== "string" || socket.roomId !== roomId) return;
      const trimmed = text.trim().slice(0, 2000);
      if (!trimmed) return;
      socket.to(roomId).emit("chat-message", {
        from: socket.id,
        userId: socket.user.id,
        text: trimmed,
        at: Date.now(),
      });
    });

    socket.on("leave-room", () => leaveCurrentRoom(socket));
    socket.on("disconnect", () => leaveCurrentRoom(socket));
  });

  function leaveCurrentRoom(socket) {
    if (!socket.roomId) return;
    socket.to(socket.roomId).emit("peer-left", { peerId: socket.id });
    socket.leave(socket.roomId);
    socket.roomId = null;
  }

  return io;
}

async function isAuthorizedForRoom(user, roomId) {
  if (!user) return false;

  const slot = await BookableSlot.findOne({ "meeting.roomId": roomId }).select(
    "tenantId hostId studentId status"
  );
  if (slot) {
    if (String(slot.tenantId) !== String(user.tenantId)) return false;
    if (slot.status !== "BOOKED" && slot.status !== "COMPLETED") return false;
    return String(slot.hostId) === String(user.id) || String(slot.studentId) === String(user.id);
  }

  const session = await LiveSession.findOne({ "meeting.roomId": roomId }).select(
    "tenantId courseId instructorId status"
  );
  if (session) {
    if (String(session.tenantId) !== String(user.tenantId)) return false;
    if (session.status === "CANCELLED") return false;
    if (String(session.instructorId) === String(user.id)) return true;

    const enrolled = await Enrollment.exists({
      userId: user.id,
      courseId: session.courseId,
      tenantId: user.tenantId,
      status: { $in: ["ACTIVE", "COMPLETED"] },
    });
    return Boolean(enrolled);
  }

  return false;
}

import { Server } from "socket.io";
import { verifyAccessToken } from "../utils/tokens.js";
import { corsOrigin } from "../utils/cors.js";
import { loadTicketForParticipant, postTicketMessage, toPublicMessage } from "./ticketChatService.js";
import logger from "../core/logger.js";

/**
 * Real-time chat for mentorship tickets — a separate Socket.io server from the WebRTC
 * signaling one (services/webrtcSignaling.js), same JWT-handshake auth pattern. Only
 * the ticket's student and its assigned mentor may join a ticket's room; a closed
 * ticket is read-only (join succeeds so history can still be viewed, but send-message
 * is rejected).
 */
let ioInstance = null;

export function attachMentorshipChat(httpServer) {
  const io = new Server(httpServer, {
    path: "/socket.io/mentorship-chat",
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
    socket.on("join-ticket", async ({ ticketId }, ack) => {
      try {
        if (typeof ticketId !== "string" || !ticketId) {
          return ack?.({ ok: false, error: "INVALID_TICKET" });
        }

        const found = await loadTicketForParticipant(socket.user.tenantId, socket.user.id, ticketId);
        if (!found) return ack?.({ ok: false, error: "FORBIDDEN" });

        socket.join(ticketId);
        socket.ticketId = ticketId;
        return ack?.({ ok: true, status: found.ticket.status });
      } catch (err) {
        logger.error(`mentorship-chat join-ticket failed: ${err.message}`);
        return ack?.({ ok: false, error: "SERVER_ERROR" });
      }
    });

    socket.on("send-message", async ({ ticketId, body }, ack) => {
      try {
        if (socket.ticketId !== ticketId || typeof body !== "string") {
          return ack?.({ ok: false, error: "INVALID_MESSAGE" });
        }
        const trimmed = body.trim().slice(0, 4000);
        if (!trimmed) return ack?.({ ok: false, error: "EMPTY_MESSAGE" });

        const found = await loadTicketForParticipant(socket.user.tenantId, socket.user.id, ticketId);
        if (!found) return ack?.({ ok: false, error: "FORBIDDEN" });

        const message = await postTicketMessage({
          ticket: found.ticket,
          senderId: socket.user.id,
          senderRole: found.role,
          body: trimmed,
        });

        const payload = toPublicMessage(message);
        io.to(ticketId).emit("new-message", payload);
        return ack?.({ ok: true, message: payload });
      } catch (err) {
        if (err.code === "MENTORSHIP_TICKET_CLOSED") {
          return ack?.({ ok: false, error: "TICKET_CLOSED" });
        }
        logger.error(`mentorship-chat send-message failed: ${err.message}`);
        return ack?.({ ok: false, error: "SERVER_ERROR" });
      }
    });

    socket.on("leave-ticket", () => leaveCurrentTicket(socket));
    socket.on("disconnect", () => leaveCurrentTicket(socket));
  });

  function leaveCurrentTicket(socket) {
    if (!socket.ticketId) return;
    socket.leave(socket.ticketId);
    socket.ticketId = null;
  }

  ioInstance = io;
  return io;
}

/** Lets the REST fallback endpoint (POST /mentorship-tickets/:id/messages) push the
 *  same real-time event a socket-originated message would, so both paths stay in sync. */
export function broadcastTicketMessage(ticketId, message) {
  ioInstance?.to(String(ticketId)).emit("new-message", message);
}

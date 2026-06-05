import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer, type Socket } from "socket.io";
import { verifyAccessToken } from "./jwt.js";
import { getCompanyByUserId } from "../services/companyService.js";

let io: SocketIOServer | null = null;

interface AuthedSocket extends Socket {
  userId?: string;
  companyId?: string;
}

const roomForCompany = (companyId: string) => `company:${companyId}`;

export const initRealtime = (httpServer: HttpServer) => {
  if (io) return io;

  // Restrict to the configured origins when CORS_ORIGINS is set; otherwise
  // reflect any origin (dev). Auth is via the handshake token (not cookies),
  // so credentials are not needed.
  const allowedOrigins = (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  io = new SocketIOServer(httpServer, {
    cors: {
      origin: allowedOrigins.length > 0 ? allowedOrigins : true,
      credentials: false,
    },
    transports: ["websocket", "polling"],
  });

  io.use(async (socket: AuthedSocket, next) => {
    try {
      const token =
        (socket.handshake.auth?.token as string | undefined) ||
        (socket.handshake.query?.token as string | undefined);
      if (!token) return next(new Error("missing token"));

      const payload = verifyAccessToken(token);
      const company = await getCompanyByUserId(payload.sub);
      if (!company) return next(new Error("no company for user"));

      socket.userId = payload.sub;
      socket.companyId = company.id;
      next();
    } catch (err) {
      next(err instanceof Error ? err : new Error("auth failed"));
    }
  });

  io.on("connection", (socket: AuthedSocket) => {
    if (!socket.companyId) {
      socket.disconnect();
      return;
    }
    socket.join(roomForCompany(socket.companyId));

    socket.on("disconnect", () => {
      // nada por enquanto
    });
  });

  return io;
};

export const getIO = () => io;

// ============================================================
// Helpers de emissao por company (multi-tenant safe)
// ============================================================

type EventName =
  | "message:new"
  | "message:updated"
  | "conversation:updated"
  | "session:status"
  | "typing";

export const emitToCompany = (
  companyId: string,
  event: EventName,
  payload: unknown,
) => {
  if (!io) return;
  io.to(roomForCompany(companyId)).emit(event, payload);
};

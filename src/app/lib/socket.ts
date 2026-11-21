import { Server as HttpServer } from "node:http";
import { JwtPayload } from "jsonwebtoken";
import { Server, Socket } from "socket.io";
import { config } from "../config";
import { RequestUser, loadAuthUser } from "../middleware/checkAuth";
import { AppError } from "../utils/AppError";
import { jwtUtils } from "../utils/jwt";

/*
 * Socket.io on the same HTTP server as Express.
 *
 * Handshake: the browser sends a short-lived socket token
 * (POST /auth/socket-token) in `auth.token`. It is signed with
 * JWT_SOCKET_SECRET, so it is never accepted by REST auth(), and the
 * httpOnly access token never reaches browser JavaScript.
 *
 * Every user joins `user:<id>`; the server emits to rooms only.
 * Single instance for now: add @socket.io/redis-adapter to scale out.
 */

export type TSocketClaims = {
  userId: string;
  role: RequestUser["role"];
  pwdAt: number | null;
};

export type TSocketData = {
  user: RequestUser;
  claims: TSocketClaims;
};

// biome-ignore lint/suspicious/noExplicitAny: socket.io's own DefaultEventsMap shape
type TEventsMap = { [event: string]: (...args: any[]) => void };

export type TAppSocket = Socket<
  TEventsMap,
  TEventsMap,
  TEventsMap,
  TSocketData
>;

export type TSocketRegistrar = (socket: TAppSocket) => void;

export const SOCKET_TOKEN_TYPE = "socket";

let io: Server | null = null;

export const userRoom = (userId: string) => `user:${userId}`;

const authenticateSocket = async (socket: TAppSocket) => {
  const token =
    typeof socket.handshake.auth?.token === "string"
      ? socket.handshake.auth.token
      : "";

  if (!token) {
    throw new AppError(401, "Socket token missing");
  }

  const verified = jwtUtils.verifyToken(token, config.jwt_socket_secret);

  if (!verified.success) {
    throw new AppError(401, "Invalid or expired socket token");
  }

  const payload = verified.data as JwtPayload;

  if (payload.typ !== SOCKET_TOKEN_TYPE || typeof payload.userId !== "string") {
    throw new AppError(401, "Invalid socket token");
  }

  const claims: TSocketClaims = {
    userId: payload.userId,
    role: payload.role,
    pwdAt: payload.pwdAt ?? null,
  };

  socket.data.user = await loadAuthUser(claims);
  socket.data.claims = claims;
};

export const initSocket = (
  httpServer: HttpServer,
  registrars: TSocketRegistrar[],
) => {
  io = new Server(httpServer, {
    cors: {
      origin: config.cors_origins,
      credentials: true,
    },
    // chat payloads are small; images go through REST multipart
    maxHttpBufferSize: 64 * 1024,
  });

  io.use((socket, next) => {
    authenticateSocket(socket as TAppSocket)
      .then(() => next())
      .catch((error) => {
        const failure = new Error(
          error instanceof AppError ? error.message : "Unauthorized",
        ) as Error & {
          data?: unknown;
        };
        failure.data = {
          statusCode: error instanceof AppError ? error.statusCode : 401,
        };
        next(failure);
      });
  });

  io.on("connection", (rawSocket) => {
    const socket = rawSocket as TAppSocket;

    socket.join(userRoom(socket.data.user.userId));

    for (const register of registrars) {
      register(socket);
    }
  });

  return io;
};

/*
 * Re-checks the socket's user (blocked, deleted, role or password change)
 * before a write. On failure the socket is disconnected.
 */
export const revalidateSocketUser = async (socket: TAppSocket) => {
  try {
    socket.data.user = await loadAuthUser(socket.data.claims);
    return socket.data.user;
  } catch (error) {
    socket.emit("auth:error", {
      message: error instanceof Error ? error.message : "Unauthorized",
    });
    socket.disconnect(true);
    return null;
  }
};

export const emitToUser = (userId: string, event: string, payload: unknown) => {
  io?.to(userRoom(userId)).emit(event, payload);
};

// single instance: the local adapter knows every connected socket
export const isUserOnline = (userId: string) =>
  Boolean(io?.sockets.adapter.rooms.get(userRoom(userId))?.size);

export const closeSocket = async () => {
  if (!io) return;

  await io.close();
  io = null;
};

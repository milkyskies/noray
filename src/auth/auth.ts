import { createHash, timingSafeEqual } from "node:crypto";
import { config } from "../config.ts";
import { NorayEvents } from "../events.ts";
import logger from "../logger.ts";
import { Noray, NorayReactor } from "../noray.ts";

const log = logger.child({ name: "mod:auth" });

const digest = (text: string) => createHash("sha256").update(text).digest();

let dispose: (() => void) | undefined;

/**
 * Require `auth <key>` as the first command on every TCP socket.
 *
 * Sockets sending anything else first, or nothing within `timeout` seconds,
 * are closed.
 */
export function requireAuth(
  key: string,
  timeout: number,
): (reactor: NorayReactor) => void {
  const expected = digest(key);

  return (reactor) => {
    stopAuth();

    const authenticated = new WeakSet<Bun.Socket>();
    const timers = new Map<Bun.Socket, ReturnType<typeof setTimeout>>();

    const clearTimer = (socket: Bun.Socket) => {
      clearTimeout(timers.get(socket));
      timers.delete(socket);
    };

    const onOpen = (socket: Bun.Socket) => {
      timers.set(
        socket,
        setTimeout(() => {
          timers.delete(socket);
          log.info("Socket sent no command in time, closing");
          socket.end();
        }, timeout * 1000),
      );
    };
    NorayEvents.on("connection-open", onOpen);
    NorayEvents.on("connection-close", clearTimer);

    dispose = () => {
      NorayEvents.off("connection-open", onOpen);
      NorayEvents.off("connection-close", clearTimer);
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };

    reactor.use((next, command, exchange) => {
      const socket = exchange.source;
      clearTimer(socket);

      if (authenticated.has(socket)) {
        if (command.name === "auth") return;
        return next();
      }

      const given = command.params?.[0] ?? command.text;
      if (
        command.name === "auth" &&
        given !== undefined &&
        timingSafeEqual(digest(given), expected)
      ) {
        authenticated.add(socket);
        return;
      }

      log.warn(
        { remoteAddress: socket.remoteAddress },
        "Socket failed to authenticate, closing",
      );
      socket.end();
    });
  };
}

/**
 * Detach the socket listeners of the active auth filter.
 */
export function stopAuth() {
  dispose?.();
  dispose = undefined;
}

Noray.hook((noray) => {
  const key = config.auth.key;
  if (!key) return;

  log.info("Auth is on, TCP sockets must send `auth <key>` first");
  noray.reactor.configure(requireAuth(key, config.auth.timeout));
  noray.on("close", stopAuth);
});

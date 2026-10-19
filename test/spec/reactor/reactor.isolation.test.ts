import { describe, it, beforeAll, afterAll, expect } from "bun:test";
import * as net from "node:net";
import { BunSocketReactor } from "@foxssake/trimsock-bun";

// Regression test for the production hang traced to trimsock-js 0.17.0, where a
// single shared parser buffer was used for every TCP connection (upstream issue
// foxssake/trimsock#57). One malformed frame desynced that shared buffer and
// silently stopped command dispatch for ALL connections until the process was
// restarted. The per-connection-reader fix (trimsock#73) landed in 0.19.0.
describe("Reactor cross-connection isolation", () => {
  let reactor: BunSocketReactor;
  let server: Bun.TCPSocketListener;
  let port: number;

  beforeAll(() => {
    reactor = new BunSocketReactor().onError((command, exchange, error) => {
      exchange.failOrSend({ name: command?.name ?? "error", text: "" + error });
    });

    reactor.on("ping", (__, exchange) => {
      exchange.send({ name: "pong", params: [] });
    });

    server = reactor.listen({ hostname: "127.0.0.1", port: 0, socket: {} });
    port = server.port;
  });

  it("a malformed frame on one connection must not stop dispatch on another", async () => {
    const poison = net.createConnection({ port, host: "127.0.0.1" });
    await new Promise<void>((resolve) => poison.once("connect", resolve));

    // Open a quoted token and never close it: with a shared parser this leaves
    // the buffer mid-quote forever, so no later command can terminate.
    poison.write('ping "unterminated');

    await new Promise((resolve) => setTimeout(resolve, 50));

    const healthy = net.createConnection({ port, host: "127.0.0.1" });
    healthy.setEncoding("utf8");
    await new Promise<void>((resolve) => healthy.once("connect", resolve));

    const reply = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Reactor wedged: no dispatch on a second connection")),
        1000,
      );
      healthy.once("data", (data) => {
        clearTimeout(timer);
        resolve(String(data));
      });
    });

    healthy.write("ping\n");

    const response = await reply;

    expect(response).toMatch(/pong/);

    poison.destroy();
    healthy.destroy();
  });

  afterAll(() => {
    server.stop(true);
  });
});

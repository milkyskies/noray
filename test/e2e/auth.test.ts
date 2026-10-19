import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { End2EndContext } from "./context.ts";
import { config } from "../../src/config.ts";
import { sleep } from "../../src/utils.ts";

const KEY = "e2e-test-key";

describe("Auth", () => {
  const context = new End2EndContext();
  let originalKey: string | undefined;

  beforeAll(async () => {
    // Config is read once at import, so flip it before the hook runs
    originalKey = config.auth.key;
    config.auth.key = KEY;
    await context.startup();
  });

  test("should allow commands after auth", async () => {
    const client = await context.connect();

    client.write(`auth ${KEY}\n`);
    client.write("register-host\n");

    const response = await context.read(client);
    expect(response.find((cmd) => cmd.startsWith("set-oid"))).not.toBeNil();
  });

  test("should close socket on command without auth", async () => {
    let closed = false;
    const client = await context.connect({ close: () => (closed = true) });

    client.write("register-host\n");
    await sleep(0.2);

    expect(closed).toBeTrue();
    expect(client.data.length).toBe(0);
  });

  test("should close socket on wrong key", async () => {
    let closed = false;
    const client = await context.connect({ close: () => (closed = true) });

    client.write("auth wrong\n");
    await sleep(0.2);

    expect(closed).toBeTrue();
  });

  afterAll(() => {
    context.shutdown();
    config.auth.key = originalKey;
  });
});

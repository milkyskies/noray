import { beforeEach, afterEach, describe, test, expect } from "bun:test";
import sinon from "sinon";
import { UDPRelayHandler } from "../../../src/relay/udp.relay.handler.ts";
import { sleep } from "../../../src/utils.ts";
import { useDynamicRelay } from "../../../src/relay/dynamic.relaying.ts";
import { RelayEntry } from "../../../src/relay/relay.entry.ts";
import { NetAddress } from "../../../src/relay/net.address.ts";
import { UDPSocket, UDPSocketPool } from "../../../src/relay/udp.socket.pool.ts";

describe("DynamicRelaying", () => {
  let clock: sinon.SinonFakeTimers;

  beforeEach(() => {
    clock = sinon.useFakeTimers();
  });

  test("should create relay", async () => {
    // Given
    const socketPool = sinon.createStubInstance(UDPSocketPool);

    const relayHandler = sinon.createStubInstance(UDPRelayHandler);
    relayHandler.on.callThrough();
    relayHandler.emit.callThrough();
    relayHandler.socketPool = socketPool;

    relayHandler.createRelay.resolves(true);
    useDynamicRelay(relayHandler);

    const senderRelay = undefined;
    const targetRelay = new RelayEntry({
      address: new NetAddress({ address: "87.54.0.16", port: 16752 }),
      port: 10007,
    });
    const senderAddress = new NetAddress({
      address: "97.32.4.16",
      port: 32775,
    });
    const targetPort = targetRelay.port;
    const messages = ["hello", "world", "use", "noray"].map((message) =>
      Buffer.from(message),
    );

    // When
    messages.forEach((message) =>
      relayHandler.emit(
        "drop",
        senderRelay,
        targetRelay,
        senderAddress,
        targetPort,
        message,
      ),
    );
    clock.restore();
    await sleep(0.05); // Wait for relay to be created
    // clock = sinon.useFakeTimers();

    // Then
    const createdRelay = relayHandler.createRelay.lastCall.args[0];
    expect(createdRelay, "Relay was not created!").not.toBeNil();
    expect(createdRelay.address).toBe(senderAddress);
    // Port is assigned by createRelay(), not by dynamic relaying

    const sent = relayHandler.relay
      .getCalls()
      .map((call) => call.args[0]?.toString());
    messages.forEach((message) =>
      expect(
        sent.includes(message.toString()),
        `Message "${message.toString()}" was not sent!`,
      ).toBeTrue(),
    );
  });

  test("should ignore known sender", async () => {
    // Given
    const relayHandler = sinon.createStubInstance(UDPRelayHandler);
    relayHandler.on.callThrough();
    relayHandler.emit.callThrough();

    useDynamicRelay(relayHandler);

    const senderRelay = new RelayEntry({
      address: new NetAddress({ address: "87.54.0.16", port: 16752 }),
      port: 10007,
    });

    const targetRelay = undefined;
    const senderAddress = new NetAddress(senderRelay.address);
    const targetPort = 10057;
    const messages = ["hello", "world", "use", "noray"].map((message) =>
      Buffer.from(message),
    );

    // When
    messages.forEach((message) =>
      relayHandler.emit(
        "drop",
        senderRelay,
        targetRelay,
        senderAddress,
        targetPort,
        message,
      ),
    );
    clock.restore();
    await sleep(0.05); // Wait for relay to be created
    // clock = sinon.useFakeTimers();

    // Then
    expect(relayHandler.createRelay.notCalled).toBeTrue();
    expect(relayHandler.relay.notCalled).toBeTrue();
  });

  test("should ignore unknown target", async () => {
    // Given
    const relayHandler = sinon.createStubInstance(UDPRelayHandler);
    relayHandler.on.callThrough();
    relayHandler.emit.callThrough();

    useDynamicRelay(relayHandler);

    const senderRelay = undefined;
    const targetRelay = undefined;
    const senderAddress = new NetAddress({
      address: "87.54.0.16",
      port: 16752,
    });
    const targetPort = 10057;
    const messages = ["hello", "world", "use", "noray"].map((message) =>
      Buffer.from(message),
    );

    // When
    messages.forEach((message) =>
      relayHandler.emit(
        "drop",
        senderRelay,
        targetRelay,
        senderAddress,
        targetPort,
        message,
      ),
    );
    clock.restore();
    await sleep(0.05); // Wait for relay to be created
    // clock = sinon.useFakeTimers();

    // Then
    expect(relayHandler.createRelay.notCalled).toBeTrue();
    expect(relayHandler.relay.notCalled).toBeTrue();
  });

  describe("with real relay handler", () => {
    const targetRelay = new RelayEntry({
      address: new NetAddress({ address: "87.54.0.16", port: 16752 }),
      port: 10000,
    });
    const senderAddress = new NetAddress({ address: "97.32.4.16", port: 32775 });

    function setup(isAllowedSender?: (sender: NetAddress) => boolean) {
      const socketPool = new UDPSocketPool();
      for (const port of [10000, 10001, 10002])
        socketPool.addSocket({ port, send: () => true, close() {} } as unknown as UDPSocket);
      const relayHandler = new UDPRelayHandler({ socketPool });
      relayHandler.createRelay(targetRelay);
      useDynamicRelay(relayHandler, isAllowedSender);
      return { socketPool, relayHandler };
    }

    async function drop(relayHandler: UDPRelayHandler) {
      relayHandler.relay(Buffer.from("hi"), senderAddress, targetRelay.port);
      clock.restore();
      await sleep(0.05);
    }

    test("should not create relay for disallowed sender", async () => {
      const { relayHandler } = setup(() => false);
      await drop(relayHandler);
      expect(relayHandler.relayTable.length).toBe(1);
    });

    test("should create relay for allowed sender", async () => {
      const { relayHandler } = setup(
        (sender) => sender.address === senderAddress.address,
      );
      await drop(relayHandler);
      expect(relayHandler.relayTable.length).toBe(2);
    });

    test("should use exactly one port per dynamic relay", async () => {
      const { relayHandler, socketPool } = setup();
      const before = socketPool["freePorts"].length;
      await drop(relayHandler);
      expect(socketPool["freePorts"].length).toBe(before - 1);

      const created = relayHandler.relayTable.find((r) =>
        r.address.equals(senderAddress),
      )!;
      relayHandler.freeRelay(created);
      expect(socketPool["freePorts"].length).toBe(before);
    });
  });

  afterEach(() => {
    clock.restore();
  });
});

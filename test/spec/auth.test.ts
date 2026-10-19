import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import sinon from "sinon";
import { requireAuth, stopAuth } from "../../src/auth/auth.ts";
import { NorayEvents } from "../../src/events.ts";
import type { NorayReactor } from "../../src/noray.ts";

const KEY = "0123456789abcdef";
const TIMEOUT = 10;

type Filter = (
  next: () => void,
  command: { name: string; params?: string[]; text?: string },
  exchange: { source: unknown },
) => void;

describe("auth", () => {
  let clock: sinon.SinonFakeTimers;
  let filter: Filter;
  let socket: { end: sinon.SinonSpy };
  let next: sinon.SinonSpy;

  const send = (name: string, ...params: string[]) =>
    filter(next, { name, params }, { source: socket });

  beforeEach(() => {
    clock = sinon.useFakeTimers();
    const use = sinon.fake();
    requireAuth(KEY, TIMEOUT)({ use } as unknown as NorayReactor);
    filter = use.firstCall.args[0];
    socket = { end: sinon.fake() };
    next = sinon.fake();
  });

  afterEach(() => {
    stopAuth();
    clock.restore();
  });

  test("should let correct key through silently", () => {
    send("auth", KEY);
    expect(socket.end.called).toBeFalse();
    expect(next.called).toBeFalse();

    send("register-host");
    expect(next.calledOnce).toBeTrue();
    expect(socket.end.called).toBeFalse();
  });

  test("should close on wrong key", () => {
    send("auth", "nope");
    expect(socket.end.calledOnce).toBeTrue();
    expect(next.called).toBeFalse();
  });

  test("should close on missing key", () => {
    send("auth");
    expect(socket.end.calledOnce).toBeTrue();
    expect(next.called).toBeFalse();
  });

  test("should close on other first command", () => {
    send("register-host");
    expect(socket.end.calledOnce).toBeTrue();
    expect(next.called).toBeFalse();
  });

  test("should ignore repeated auth", () => {
    send("auth", KEY);
    send("auth", KEY);
    send("auth", "wrong");
    expect(socket.end.called).toBeFalse();
    expect(next.called).toBeFalse();
  });

  test("should close silent socket after timeout", () => {
    NorayEvents.emit("connection-open", socket as never);
    clock.tick(TIMEOUT * 1000 - 1);
    expect(socket.end.called).toBeFalse();
    clock.tick(1);
    expect(socket.end.calledOnce).toBeTrue();
  });

  test("should not time out authenticated socket", () => {
    NorayEvents.emit("connection-open", socket as never);
    send("auth", KEY);
    clock.tick(TIMEOUT * 1000 * 2);
    expect(socket.end.called).toBeFalse();
  });

  test("should not time out closed socket", () => {
    NorayEvents.emit("connection-open", socket as never);
    NorayEvents.emit("connection-close", socket as never);
    clock.tick(TIMEOUT * 1000 * 2);
    expect(socket.end.called).toBeFalse();
  });

  test("should stop listening after dispose", () => {
    stopAuth();
    NorayEvents.emit("connection-open", socket as never);
    clock.tick(TIMEOUT * 1000 * 2);
    expect(socket.end.called).toBeFalse();
  });
});

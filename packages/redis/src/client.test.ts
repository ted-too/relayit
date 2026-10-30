import { describe, expect, test } from "bun:test";
import {
  isRedisConnectionError,
  makeRedisClient,
  type RedisCommandClient,
  type RedisReconnectEvent,
} from "./client";

const connectionClosed = () =>
  Object.assign(new Error("Connection has failed"), {
    code: "ERR_REDIS_CONNECTION_CLOSED",
  });

const serverError = () =>
  Object.assign(new Error("WRONGTYPE Operation against a key"), {
    code: "ERR_REDIS_SERVER_ERROR",
  });

interface FakeClient extends RedisCommandClient {
  readonly calls: string[][];
  closed: boolean;
}

/** Each opened client replays the next scripted outcome per `send`. */
const scripted = (...outcomes: (() => Promise<unknown>)[]) => {
  const clients: FakeClient[] = [];
  const open = (): FakeClient => {
    const outcome = outcomes.shift();
    const client: FakeClient = {
      calls: [],
      close: () => {
        client.closed = true;
      },
      closed: false,
      send: (command, args) => {
        client.calls.push([command, ...args]);
        return outcome ? outcome() : Promise.resolve("OK");
      },
    };
    clients.push(client);
    return client;
  };
  return { clients, open };
};

describe("makeRedisClient", () => {
  test("classifies Bun connection errors by code", () => {
    expect(isRedisConnectionError(connectionClosed())).toBe(true);
    expect(
      isRedisConnectionError(
        Object.assign(new Error("Connection timeout reached after 10000ms"), {
          code: "ERR_REDIS_CONNECTION_TIMEOUT",
        })
      )
    ).toBe(true);
    expect(isRedisConnectionError(serverError())).toBe(false);
    expect(isRedisConnectionError(new Error("Connection closed"))).toBe(true);
    expect(isRedisConnectionError("nope")).toBe(false);
  });

  test("replaces a failed client and replays the command once", async () => {
    const { clients, open } = scripted(
      () => Promise.reject(connectionClosed()),
      () => Promise.resolve("PONG")
    );
    const events: RedisReconnectEvent[] = [];
    const client = makeRedisClient({
      onReconnect: (event) => events.push(event),
      open,
      url: "redis://test",
    });

    await expect(client.send("PING", [])).resolves.toBe("PONG");
    expect(clients).toHaveLength(2);
    expect(clients[0]?.closed).toBe(true);
    expect(clients[1]?.calls).toEqual([["PING"]]);
    expect(events).toEqual([
      {
        cause: expect.objectContaining({ code: "ERR_REDIS_CONNECTION_CLOSED" }),
        code: "ERR_REDIS_CONNECTION_CLOSED",
        command: "PING",
      },
    ]);
  });

  test("surfaces the second failure when the replacement is also down", async () => {
    const { clients, open } = scripted(
      () => Promise.reject(connectionClosed()),
      () => Promise.reject(connectionClosed())
    );
    const client = makeRedisClient({ open, url: "redis://test" });

    await expect(client.send("GET", ["k"])).rejects.toMatchObject({
      code: "ERR_REDIS_CONNECTION_CLOSED",
    });
    expect(clients).toHaveLength(2);

    // The next command replaces the failed replacement as well.
    await expect(client.send("GET", ["k"])).resolves.toBe("OK");
    expect(clients).toHaveLength(3);
    expect(clients[1]?.closed).toBe(true);
  });

  test("does not replace the client for non-connection errors", async () => {
    const { clients, open } = scripted(() => Promise.reject(serverError()));
    const client = makeRedisClient({ open, url: "redis://test" });

    await expect(client.send("GET", ["k"])).rejects.toMatchObject({
      code: "ERR_REDIS_SERVER_ERROR",
    });
    expect(clients).toHaveLength(1);
    expect(clients[0]?.closed).toBe(false);
  });

  test("concurrent failures share a single replacement", async () => {
    const { clients, open } = scripted(
      () => Promise.reject(connectionClosed()),
      () => Promise.resolve("OK")
    );
    const events: RedisReconnectEvent[] = [];
    const client = makeRedisClient({
      onReconnect: (event) => events.push(event),
      open,
      url: "redis://test",
    });

    await Promise.all([
      client.send("SET", ["a", "1"]),
      client.send("SET", ["b", "2"]),
      client.send("SET", ["c", "3"]),
    ]);
    expect(clients).toHaveLength(2);
    expect(clients[1]?.calls).toHaveLength(3);
    expect(events).toHaveLength(1);
  });

  test("does not reopen after close", async () => {
    const { clients, open } = scripted(() =>
      Promise.reject(connectionClosed())
    );
    const client = makeRedisClient({ open, url: "redis://test" });
    client.close();

    await expect(client.send("PING", [])).rejects.toMatchObject({
      code: "ERR_REDIS_CONNECTION_CLOSED",
    });
    expect(clients).toHaveLength(1);
    expect(clients[0]?.closed).toBe(true);
  });
});

/**
 * Request pacing and rate-limit retry in the API client (offline).
 *
 * The gap between requests is measured on the clock from send to send, so
 * time the caller spends between calls counts towards it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  WorldAnvilClient,
  DEFAULT_MIN_INTERVAL_MS,
  RATE_LIMIT_PAUSE_MS,
} from "../src/api-client.js";

function makeClient(config = {}) {
  const client = new WorldAnvilClient({ appKey: "k", authToken: "t", ...config });
  const sentAt = [];
  client.send = vi.fn(async (endpoint) => {
    sentAt.push(Date.now());
    return { endpoint };
  });
  return { client, sentAt };
}

function rateLimited(retryAfter) {
  const err = new Error("API Error (429): slow down");
  err.status = 429;
  if (retryAfter !== undefined) err.retryAfter = retryAfter;
  return err;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("pacing", () => {
  it("defaults to 750 ms", () => {
    expect(DEFAULT_MIN_INTERVAL_MS).toBe(750);
    expect(makeClient().client.minIntervalMs).toBe(750);
  });

  it("sends the first request straight away", async () => {
    const { client, sentAt } = makeClient();
    await client.request("/a");
    expect(sentAt).toEqual([1_000_000]);
  });

  it("holds a request made too soon until the gap has passed", async () => {
    const { client, sentAt } = makeClient();
    await client.request("/a");
    await vi.advanceTimersByTimeAsync(200); // caller busy for 200 ms
    const second = client.request("/b");
    await vi.advanceTimersByTimeAsync(549);
    expect(sentAt).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(sentAt[1] - sentAt[0]).toBe(750);
  });

  it("counts time between calls: no wait when the gap has already passed", async () => {
    const { client, sentAt } = makeClient();
    await client.request("/a");
    await vi.advanceTimersByTimeAsync(2000); // caller thinking for 2 s
    await client.request("/b");
    expect(sentAt[1] - sentAt[0]).toBe(2000);
  });

  it("sends requests made together one at a time, in order", async () => {
    const { client, sentAt } = makeClient();
    const all = Promise.all([client.request("/a"), client.request("/b"), client.request("/c")]);
    await vi.advanceTimersByTimeAsync(1500);
    const results = await all;
    expect(results.map((r) => r.endpoint)).toEqual(["/a", "/b", "/c"]);
    expect(sentAt.map((t) => t - sentAt[0])).toEqual([0, 750, 1500]);
  });

  it("keeps going after a failed request", async () => {
    const { client, sentAt } = makeClient();
    client.send.mockRejectedValueOnce(new Error("API Error (422): nope"));
    await expect(client.request("/a")).rejects.toThrow(/422/);
    const next = client.request("/b");
    await vi.advanceTimersByTimeAsync(750);
    await expect(next).resolves.toEqual({ endpoint: "/b" });
    expect(sentAt).toHaveLength(1);
  });

  it("can be changed, and rejects a nonsense setting", () => {
    expect(makeClient({ minIntervalMs: 0 }).client.minIntervalMs).toBe(0);
    expect(() => makeClient({ minIntervalMs: "fast" })).toThrow(/WA_MIN_INTERVAL_MS/);
    expect(() => makeClient({ minIntervalMs: -1 })).toThrow(/WA_MIN_INTERVAL_MS/);
  });

  it("still paces when the client object is frozen", async () => {
    const { client, sentAt } = makeClient();
    Object.freeze(client);
    await client.request("/a");
    const second = client.request("/b");
    await vi.advanceTimersByTimeAsync(750);
    await second;
    expect(sentAt[1] - sentAt[0]).toBe(750);
  });
});

describe("rate-limit answers", () => {
  it("retries once after a pause", async () => {
    const { client } = makeClient();
    client.send.mockRejectedValueOnce(rateLimited());
    const p = client.request("/a");
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_PAUSE_MS - 1);
    expect(client.send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toEqual({ endpoint: "/a" });
    expect(client.send).toHaveBeenCalledTimes(2);
  });

  it("waits as long as World Anvil asks, up to a limit", async () => {
    const { client } = makeClient();
    client.send.mockRejectedValueOnce(rateLimited("12"));
    const p = client.request("/a");
    await vi.advanceTimersByTimeAsync(11_999);
    expect(client.send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(client.send).toHaveBeenCalledTimes(2);
  });

  it("gives up after a second one, in plain words", async () => {
    const { client } = makeClient();
    client.send.mockRejectedValue(rateLimited());
    const p = client.request("/a");
    const caught = expect(p).rejects.toThrow(/limiting requests.*changed nothing.*try again/s);
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_PAUSE_MS);
    await caught;
    expect(client.send).toHaveBeenCalledTimes(2);
  });

  it("does not retry other errors", async () => {
    const { client } = makeClient();
    client.send.mockRejectedValueOnce(Object.assign(new Error("API Error (500): boom"), { status: 500 }));
    await expect(client.request("/a")).rejects.toThrow(/500/);
    expect(client.send).toHaveBeenCalledTimes(1);
  });
});

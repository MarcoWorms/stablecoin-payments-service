import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import { DatabaseStore } from "../src/db/store.js";
import { MonitorService } from "../src/services/monitor-service.js";
import { normalizeAddress } from "../src/utils/address.js";

const WATCH_ADDRESS = normalizeAddress("0x000000000000000000000000000000000000dEaD");
const TOKEN_ADDRESS = normalizeAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");

const cleanupPaths: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const path of cleanupPaths.splice(0)) {
    rmSync(path, { force: true, recursive: true });
  }
});

describe("MonitorService", () => {
  it("backs off repeated target sync failures until the retry window expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-06T18:00:00.000Z"));

    const store = createStore();
    store.createOrUpdateWatch({
      address: WATCH_ADDRESS,
      targets: [
        {
          chainKey: "ethereum",
          key: "usdc",
          symbol: "USDC",
          address: TOKEN_ADDRESS,
          decimals: 6,
          confirmations: 15,
          startBlock: 100,
        },
      ],
    });

    const getBlockNumber = vi.fn(async () => {
      throw new Error("rpc temporarily unavailable");
    });
    const monitor = new MonitorService(
      store,
      {
        getClient: () => ({ getBlockNumber }),
        getChain: () => ({ name: "Ethereum" }),
        getMaxBatchBlocks: () => 3_000,
      } as never,
      buildLogger(),
      15_000,
      {
        rpcRequestTimeoutMs: 25,
        targetErrorRetryMs: 60_000,
      },
    );

    await monitor.tick();
    expect(getBlockNumber).toHaveBeenCalledTimes(1);
    expect(store.listActiveTargets()[0]?.lastError).toContain("rpc temporarily unavailable");

    await monitor.tick();
    expect(getBlockNumber).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    await monitor.tick();
    expect(getBlockNumber).toHaveBeenCalledTimes(2);

    store.close();
  });

  it("times out stalled RPC requests instead of hanging the monitor loop", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-06T18:00:00.000Z"));

    const store = createStore();
    store.createOrUpdateWatch({
      address: WATCH_ADDRESS,
      targets: [
        {
          chainKey: "ethereum",
          key: "usdc",
          symbol: "USDC",
          address: TOKEN_ADDRESS,
          decimals: 6,
          confirmations: 15,
          startBlock: 100,
        },
      ],
    });

    const getBlockNumber = vi.fn(() => new Promise<bigint>(() => undefined));
    const monitor = new MonitorService(
      store,
      {
        getClient: () => ({ getBlockNumber }),
        getChain: () => ({ name: "Ethereum" }),
        getMaxBatchBlocks: () => 3_000,
      } as never,
      buildLogger(),
      15_000,
      {
        rpcRequestTimeoutMs: 25,
        targetErrorRetryMs: 60_000,
      },
    );

    const pendingTick = monitor.tick();
    await vi.advanceTimersByTimeAsync(25);
    await pendingTick;

    expect(getBlockNumber).toHaveBeenCalledTimes(1);
    expect(store.listActiveTargets()[0]?.lastError).toContain("head lookup timed out after 25ms");

    store.close();
  });
});

function createStore(): DatabaseStore {
  const directory = mkdtempSync(join(tmpdir(), "stablecoin-payments-monitor-"));
  cleanupPaths.push(directory);
  return new DatabaseStore(join(directory, "test.db"));
}

function buildLogger() {
  return {
    debug: vi.fn(),
    error: vi.fn(),
  };
}

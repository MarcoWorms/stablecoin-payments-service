import { describe, expect, it, vi, afterEach } from "vitest";

import { WatchService } from "../src/services/watch-service.js";
import { normalizeAddress } from "../src/utils/address.js";

const WATCH_ADDRESS = normalizeAddress("0x000000000000000000000000000000000000dEaD");
const TOKEN_ADDRESS = normalizeAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");

afterEach(() => {
  vi.useRealTimers();
});

describe("WatchService", () => {
  it("times out stalled start-block lookups instead of hanging watch creation", async () => {
    vi.useFakeTimers();

    const createOrUpdateWatch = vi.fn();
    const service = new WatchService(
      {
        createOrUpdateWatch,
      } as never,
      {
        isEnabled: () => true,
        getClient: () => ({
          getBlockNumber: () => new Promise<bigint>(() => undefined),
        }),
        getChain: () => ({
          defaultConfirmations: 15,
          name: "Ethereum",
        }),
        getDefaultTokens: () => [
          {
            key: "usdc",
            symbol: "USDC",
            address: TOKEN_ADDRESS,
            decimals: 6,
          },
        ],
      } as never,
      {
        info: vi.fn(),
      } as never,
      25,
    );

    const pendingUpsert = service.upsertWatch({
      address: WATCH_ADDRESS,
      chains: ["ethereum"],
      includeDefaultTokens: true,
      customTokens: [],
    });
    const pendingAssertion = expect(pendingUpsert).rejects.toThrow("start-block lookup timed out after 25ms");

    await vi.advanceTimersByTimeAsync(25);
    await pendingAssertion;
    expect(createOrUpdateWatch).not.toHaveBeenCalled();
  });
});

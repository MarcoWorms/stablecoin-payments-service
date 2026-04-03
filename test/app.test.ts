import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import type { AppConfig } from "../src/types.js";
import { normalizeAddress } from "../src/utils/address.js";
import { toSafeErrorMessage } from "../src/utils/errors.js";

const USDC_ETHEREUM = normalizeAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
const WATCH_ADDRESS = normalizeAddress("0x000000000000000000000000000000000000dEaD");
const PAYER_ADDRESS = normalizeAddress("0x000000000000000000000000000000000000bEEF");

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const path of cleanupPaths.splice(0)) {
    rmSync(path, { force: true, recursive: true });
  }
});

describe("stablecoin payments service", () => {
  it("aggregates payments into payer summaries", async () => {
    const context = await buildTestApp();
    const watch = context.store.createOrUpdateWatch({
      address: WATCH_ADDRESS,
      label: "Treasury",
      targets: [
        {
          chainKey: "ethereum",
          key: "usdc",
          symbol: "USDC",
          address: USDC_ETHEREUM,
          decimals: 6,
          confirmations: 15,
          startBlock: 100,
        },
      ],
    });

    const [target] = watch.targets;
    expect(target).toBeDefined();
    context.store.recordPayment({
      watchId: watch.id,
      targetId: target!.id,
      chainKey: "ethereum",
      tokenKey: "usdc",
      tokenSymbol: "USDC",
      tokenAddress: USDC_ETHEREUM,
      tokenDecimals: 6,
      txHash: "0x1",
      logIndex: 0,
      blockNumber: 101,
      blockHash: "0xa",
      payerAddress: PAYER_ADDRESS,
      recipientAddress: WATCH_ADDRESS,
      rawAmount: "2500000",
      finalizedAt: "2026-01-01T00:00:00.000Z",
    });

    context.store.recordPayment({
      watchId: watch.id,
      targetId: target!.id,
      chainKey: "ethereum",
      tokenKey: "usdc",
      tokenSymbol: "USDC",
      tokenAddress: USDC_ETHEREUM,
      tokenDecimals: 6,
      txHash: "0x2",
      logIndex: 1,
      blockNumber: 102,
      blockHash: "0xb",
      payerAddress: PAYER_ADDRESS,
      recipientAddress: WATCH_ADDRESS,
      rawAmount: "500000",
      finalizedAt: "2026-01-01T00:01:00.000Z",
    });

    const response = await context.app.inject({
      method: "GET",
      url: `/v1/watches/${watch.id}/payers`,
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0].paymentCount).toBe(2);
    expect(payload.items[0].totalRawAmount).toBe("3000000");
    expect(payload.items[0].totalAmount).toBe("3");

    await context.app.close();
  });

  it("returns 304 when the payer list has not changed", async () => {
    const context = await buildTestApp();
    const watch = context.store.createOrUpdateWatch({
      address: WATCH_ADDRESS,
      targets: [
        {
          chainKey: "ethereum",
          key: "usdc",
          symbol: "USDC",
          address: USDC_ETHEREUM,
          decimals: 6,
          confirmations: 15,
          startBlock: 100,
        },
      ],
    });

    const [target] = watch.targets;
    expect(target).toBeDefined();
    context.store.recordPayment({
      watchId: watch.id,
      targetId: target!.id,
      chainKey: "ethereum",
      tokenKey: "usdc",
      tokenSymbol: "USDC",
      tokenAddress: USDC_ETHEREUM,
      tokenDecimals: 6,
      txHash: "0x3",
      logIndex: 0,
      blockNumber: 101,
      blockHash: "0xc",
      payerAddress: PAYER_ADDRESS,
      recipientAddress: WATCH_ADDRESS,
      rawAmount: "1000000",
      finalizedAt: "2026-01-01T00:00:00.000Z",
    });

    const firstResponse = await context.app.inject({
      method: "GET",
      url: `/v1/watches/${watch.id}/payers`,
    });

    expect(firstResponse.statusCode).toBe(200);
    expect(firstResponse.headers.etag).toBeTruthy();

    const secondResponse = await context.app.inject({
      method: "GET",
      url: `/v1/watches/${watch.id}/payers`,
      headers: {
        "if-none-match": String(firstResponse.headers.etag),
      },
    });

    expect(secondResponse.statusCode).toBe(304);
    await context.app.close();
  });

  it("requires auth on API routes when auth tokens are configured", async () => {
    const context = await buildTestApp({
      authTokens: ["super-secret-token"],
    });

    const unauthenticatedResponse = await context.app.inject({
      method: "GET",
      url: "/v1/watches",
    });

    expect(unauthenticatedResponse.statusCode).toBe(401);

    const authenticatedResponse = await context.app.inject({
      method: "GET",
      url: "/v1/watches",
      headers: {
        authorization: "Bearer super-secret-token",
      },
    });

    expect(authenticatedResponse.statusCode).toBe(200);
    await context.app.close();
  });

  it("keeps health public even when auth is enabled", async () => {
    const context = await buildTestApp({
      authTokens: ["super-secret-token"],
    });

    const response = await context.app.inject({
      method: "GET",
      url: "/v1/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().authEnabled).toBe(true);
    await context.app.close();
  });

  it("redacts URLs and request bodies from persisted error messages", () => {
    const message = toSafeErrorMessage(
      new Error(
        'An internal error was received. URL: https://rpc.example Request body: {"method":"eth_getLogs","params":[]}',
      ),
    );

    expect(message).not.toContain("https://rpc.example");
    expect(message).not.toContain('"method":"eth_getLogs"');
    expect(message).toContain("Request body omitted.");
  });

  it("exposes the expanded multichain registry defaults", async () => {
    const context = await buildTestApp({
      enabledChains: ["ethereum", "polygon", "base", "optimism", "arbitrum", "bsc", "megaeth", "monad"],
    });

    const response = await context.app.inject({
      method: "GET",
      url: "/v1/registry",
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.chains.map((entry: { key: string }) => entry.key)).toEqual([
      "ethereum",
      "polygon",
      "base",
      "optimism",
      "arbitrum",
      "bsc",
      "megaeth",
      "monad",
    ]);
    expect(payload.chains.find((entry: { key: string }) => entry.key === "polygon")?.defaultTokens).toEqual([
      expect.objectContaining({ key: "usdc", symbol: "USDC" }),
      expect.objectContaining({ key: "usdt", symbol: "USDT" }),
    ]);
    expect(payload.chains.find((entry: { key: string }) => entry.key === "optimism")?.defaultTokens).toEqual([
      expect.objectContaining({ key: "usdc", symbol: "USDC" }),
      expect.objectContaining({ key: "usdt", symbol: "USDT0" }),
    ]);
    expect(payload.chains.find((entry: { key: string }) => entry.key === "megaeth")?.defaultTokens).toEqual([
      expect.objectContaining({ key: "usdt", symbol: "USDT0" }),
    ]);
    expect(payload.chains.find((entry: { key: string }) => entry.key === "monad")?.defaultTokens).toEqual([
      expect.objectContaining({ key: "usdc", symbol: "USDC" }),
      expect.objectContaining({ key: "usdt", symbol: "USDT0" }),
    ]);

    await context.app.close();
  });
});

async function buildTestApp(overrides: Partial<AppConfig> = {}) {
  const directory = mkdtempSync(join(tmpdir(), "stablecoin-payments-"));
  cleanupPaths.push(directory);

  return createApp({
    host: "127.0.0.1",
    port: 0,
    databasePath: join(directory, "test.db"),
    pollIntervalMs: 60_000,
    httpCacheTtlMs: 60_000,
    cacheMaxEntries: 64,
    bodyLimitBytes: 64 * 1024,
    enabledChains: ["ethereum"],
    adminUiEnabled: false,
    allowedOrigins: [],
    authTokens: [],
    ...overrides,
  });
}

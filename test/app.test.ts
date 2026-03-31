import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { normalizeAddress } from "../src/utils/address.js";

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
});

async function buildTestApp() {
  const directory = mkdtempSync(join(tmpdir(), "stablecoin-payments-"));
  cleanupPaths.push(directory);

  return createApp({
    host: "127.0.0.1",
    port: 0,
    databasePath: join(directory, "test.db"),
    pollIntervalMs: 60_000,
    httpCacheTtlMs: 60_000,
    enabledChains: ["ethereum"],
    adminUiEnabled: false,
  });
}

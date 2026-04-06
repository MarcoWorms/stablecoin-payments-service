import type { FastifyBaseLogger } from "fastify";
import { parseAbiItem, type Address } from "viem";

import { ChainRegistry } from "../chains/registry.js";
import { DatabaseStore } from "../db/store.js";
import type { ActiveTargetRecord } from "../types.js";
import { toSafeErrorMessage } from "../utils/errors.js";
import { withTimeout } from "../utils/timeout.js";

const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

interface MonitorServiceOptions {
  rpcRequestTimeoutMs?: number;
  targetErrorRetryMs?: number;
}

export class MonitorService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly rpcRequestTimeoutMs: number;
  private readonly targetErrorRetryMs: number;

  constructor(
    private readonly store: DatabaseStore,
    private readonly registry: ChainRegistry,
    private readonly logger: FastifyBaseLogger,
    private readonly pollIntervalMs: number,
    options: MonitorServiceOptions = {},
  ) {
    this.rpcRequestTimeoutMs = options.rpcRequestTimeoutMs ?? 5_000;
    this.targetErrorRetryMs = options.targetErrorRetryMs ?? 60_000;
  }

  start(): void {
    if (this.timer) {
      return;
    }

    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      const targets = this.store.listActiveTargets();
      for (const target of targets) {
        if (this.shouldBackOffTarget(target)) {
          this.logger.debug(
            {
              watchId: target.watchId,
              targetId: target.id,
              chainKey: target.chainKey,
              token: target.tokenSymbol,
            },
            "Skipping target sync during retry backoff window",
          );
          continue;
        }

        await this.syncTarget(target);
      }
    } finally {
      this.running = false;
    }
  }

  private async syncTarget(target: ActiveTargetRecord): Promise<void> {
    try {
      const client = this.registry.getClient(target.chainKey);
      const chain = this.registry.getChain(target.chainKey);
      const currentBlock = Number(
        await withTimeout(
          client.getBlockNumber(),
          this.rpcRequestTimeoutMs,
          `${chain.name} head lookup`,
        ),
      );
      const finalizedHead = currentBlock - target.confirmations;

      if (finalizedHead < target.nextFromBlock) {
        return;
      }

      const timestampCache = new Map<number, string>();
      let fromBlock = target.nextFromBlock;

      while (fromBlock <= finalizedHead) {
        const toBlock = Math.min(finalizedHead, fromBlock + this.registry.getMaxBatchBlocks(target.chainKey) - 1);
        const logs = await withTimeout(
          client.getLogs({
            address: target.tokenAddress,
            event: transferEvent,
            args: {
              to: target.watchAddress,
            },
            fromBlock: BigInt(fromBlock),
            toBlock: BigInt(toBlock),
          }),
          this.rpcRequestTimeoutMs,
          `${chain.name} transfer scan`,
        );

        for (const log of logs) {
          const args = log.args as { from?: Address; to?: Address; value?: bigint };
          if (!args.from || args.value === undefined) {
            continue;
          }

          const finalizedAt = await this.resolveBlockTimestampIso(timestampCache, client, chain.name, log.blockNumber);
          this.store.recordPayment({
            watchId: target.watchId,
            targetId: target.id,
            chainKey: target.chainKey,
            tokenKey: target.tokenKey,
            tokenSymbol: target.tokenSymbol,
            tokenAddress: target.tokenAddress,
            tokenDecimals: target.tokenDecimals,
            txHash: log.transactionHash,
            logIndex: Number(log.logIndex),
            blockNumber: Number(log.blockNumber),
            blockHash: log.blockHash ?? null,
            payerAddress: args.from,
            recipientAddress: target.watchAddress,
            rawAmount: args.value.toString(),
            finalizedAt,
          });
        }

        this.store.updateTargetProgress(target.id, toBlock + 1, toBlock);
        fromBlock = toBlock + 1;
      }

      this.logger.debug(
        {
          watchId: target.watchId,
          chainKey: target.chainKey,
          token: target.tokenSymbol,
          syncedToBlock: finalizedHead,
          confirmations: target.confirmations,
          batchSize: chain.maxBatchBlocks,
        },
        "Watch target synced",
      );
    } catch (error) {
      const message = toSafeErrorMessage(error, "Target sync failed");
      this.store.updateTargetError(target.id, message);
      this.logger.error(
        {
          watchId: target.watchId,
          targetId: target.id,
          chainKey: target.chainKey,
          token: target.tokenSymbol,
          error: message,
        },
        "Watch target sync failed",
      );
    }
  }

  private async resolveBlockTimestampIso(
    cache: Map<number, string>,
    client: ReturnType<ChainRegistry["getClient"]>,
    chainName: string,
    blockNumber: bigint,
  ): Promise<string> {
    const numericBlock = Number(blockNumber);
    const cached = cache.get(numericBlock);
    if (cached) {
      return cached;
    }

    const block = await withTimeout(
      client.getBlock({ blockNumber }),
      this.rpcRequestTimeoutMs,
      `${chainName} block lookup`,
    );
    const value = new Date(Number(block.timestamp) * 1_000).toISOString();
    cache.set(numericBlock, value);
    return value;
  }

  private shouldBackOffTarget(target: ActiveTargetRecord): boolean {
    if (!target.lastError) {
      return false;
    }

    const lastFailureAt = Date.parse(target.updatedAt);
    if (Number.isNaN(lastFailureAt)) {
      return false;
    }

    return Date.now() - lastFailureAt < this.targetErrorRetryMs;
  }
}

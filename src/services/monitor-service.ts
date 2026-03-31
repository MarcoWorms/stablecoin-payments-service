import type { FastifyBaseLogger } from "fastify";
import { parseAbiItem, type Address } from "viem";

import { ChainRegistry } from "../chains/registry.js";
import { DatabaseStore } from "../db/store.js";
import type { ActiveTargetRecord } from "../types.js";

const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

export class MonitorService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly store: DatabaseStore,
    private readonly registry: ChainRegistry,
    private readonly logger: FastifyBaseLogger,
    private readonly pollIntervalMs: number,
  ) {}

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
      const currentBlock = Number(await client.getBlockNumber());
      const finalizedHead = currentBlock - target.confirmations;

      if (finalizedHead < target.nextFromBlock) {
        return;
      }

      const timestampCache = new Map<number, string>();
      let fromBlock = target.nextFromBlock;

      while (fromBlock <= finalizedHead) {
        const toBlock = Math.min(finalizedHead, fromBlock + this.registry.getMaxBatchBlocks(target.chainKey) - 1);
        const logs = await client.getLogs({
          address: target.tokenAddress,
          event: transferEvent,
          args: {
            to: target.watchAddress,
          },
          fromBlock: BigInt(fromBlock),
          toBlock: BigInt(toBlock),
        });

        for (const log of logs) {
          const args = log.args as { from?: Address; to?: Address; value?: bigint };
          if (!args.from || args.value === undefined) {
            continue;
          }

          const finalizedAt = await this.resolveBlockTimestampIso(timestampCache, client, log.blockNumber);
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
      const message = error instanceof Error ? error.message : String(error);
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
    blockNumber: bigint,
  ): Promise<string> {
    const numericBlock = Number(blockNumber);
    const cached = cache.get(numericBlock);
    if (cached) {
      return cached;
    }

    const block = await client.getBlock({ blockNumber });
    const value = new Date(Number(block.timestamp) * 1_000).toISOString();
    cache.set(numericBlock, value);
    return value;
  }
}

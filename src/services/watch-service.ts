import type { FastifyBaseLogger } from "fastify";

import { normalizeAddress } from "../utils/address.js";
import { withTimeout } from "../utils/timeout.js";
import { ChainRegistry } from "../chains/registry.js";
import { DatabaseStore } from "../db/store.js";
import type { ChainKey, CreateWatchInput, WatchRecord, WatchTargetInput } from "../types.js";

export class WatchService {
  constructor(
    private readonly store: DatabaseStore,
    private readonly registry: ChainRegistry,
    private readonly logger: FastifyBaseLogger,
    private readonly rpcRequestTimeoutMs = 5_000,
  ) {}

  async upsertWatch(input: CreateWatchInput): Promise<WatchRecord> {
    const targetMap = new Map<string, WatchTargetInput>();
    const chainsToResolve = new Set<ChainKey>(input.chains);
    const startBlocks = new Map<ChainKey, number>();

    for (const customToken of input.customTokens) {
      chainsToResolve.add(customToken.chainKey);
    }

    for (const chainKey of chainsToResolve) {
      if (!this.registry.isEnabled(chainKey)) {
        throw new Error(`Chain ${chainKey} is not enabled by this deployment`);
      }
    }

    if (input.includeDefaultTokens) {
      for (const chainKey of input.chains) {
        const startBlock = await this.resolveStartBlock(chainKey, input.lookbackBlocks, startBlocks);
        for (const token of this.registry.getDefaultTokens(chainKey)) {
          targetMap.set(`${chainKey}:${token.address.toLowerCase()}`, {
            ...token,
            chainKey,
            confirmations: this.registry.getChain(chainKey).defaultConfirmations,
            startBlock,
          });
        }
      }
    }

    for (const token of input.customTokens) {
      const startBlock = await this.resolveStartBlock(token.chainKey, input.lookbackBlocks, startBlocks);
      targetMap.set(`${token.chainKey}:${token.address.toLowerCase()}`, {
        key: token.key ?? `${token.symbol.toLowerCase()}-${token.address.slice(2, 8).toLowerCase()}`,
        symbol: token.symbol,
        address: normalizeAddress(token.address),
        decimals: token.decimals,
        chainKey: token.chainKey,
        confirmations: this.registry.getChain(token.chainKey).defaultConfirmations,
        startBlock,
      });
    }

    if (targetMap.size === 0) {
      throw new Error("No tokens were selected. Pick at least one default or custom token.");
    }

    const watch = this.store.createOrUpdateWatch({
      address: normalizeAddress(input.address),
      label: input.label,
      targets: [...targetMap.values()],
    });

    this.logger.info(
      {
        watchId: watch.id,
        address: watch.address,
        targetCount: watch.targets.filter((target) => target.isActive).length,
      },
      "Watch upserted",
    );

    return watch;
  }

  private async resolveStartBlock(
    chainKey: ChainKey,
    lookbackBlocks: number | undefined,
    cache: Map<ChainKey, number>,
  ): Promise<number> {
    const cached = cache.get(chainKey);
    if (cached !== undefined) {
      return cached;
    }

    const client = this.registry.getClient(chainKey);
    const chain = this.registry.getChain(chainKey);
    const currentBlock = Number(
      await withTimeout(
        client.getBlockNumber(),
        this.rpcRequestTimeoutMs,
        `${chain.name} start-block lookup`,
      ),
    );
    const finalizedHead = Math.max(0, currentBlock - chain.defaultConfirmations);
    const startBlock =
      lookbackBlocks && lookbackBlocks > 0 ? Math.max(0, finalizedHead - lookbackBlocks + 1) : finalizedHead + 1;

    cache.set(chainKey, startBlock);
    return startBlock;
  }
}

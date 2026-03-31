import { arbitrum, base, mainnet, optimism } from "viem/chains";
import { http, createPublicClient, type Address, type Chain, type PublicClient } from "viem";

import { normalizeAddress } from "../utils/address.js";
import type { ChainDefinition, ChainKey, TokenDefinition } from "../types.js";

interface RuntimeChainDefinition extends ChainDefinition {
  chain: Chain;
}

const CHAIN_REGISTRY: Record<ChainKey, RuntimeChainDefinition> = {
  ethereum: {
    key: "ethereum",
    chain: mainnet,
    chainId: mainnet.id,
    name: "Ethereum",
    envRpcKey: "ETHEREUM_RPC_URL",
    defaultConfirmations: 15,
    maxBatchBlocks: 1_500,
  },
  arbitrum: {
    key: "arbitrum",
    chain: arbitrum,
    chainId: arbitrum.id,
    name: "Arbitrum",
    envRpcKey: "ARBITRUM_RPC_URL",
    defaultConfirmations: 20,
    maxBatchBlocks: 3_000,
  },
  optimism: {
    key: "optimism",
    chain: optimism,
    chainId: optimism.id,
    name: "Optimism",
    envRpcKey: "OPTIMISM_RPC_URL",
    defaultConfirmations: 20,
    maxBatchBlocks: 3_000,
  },
  base: {
    key: "base",
    chain: base,
    chainId: base.id,
    name: "Base",
    envRpcKey: "BASE_RPC_URL",
    defaultConfirmations: 20,
    maxBatchBlocks: 3_000,
  },
};

const DEFAULT_TOKENS: Record<ChainKey, TokenDefinition[]> = {
  ethereum: [
    {
      key: "usdc",
      symbol: "USDC",
      address: normalizeAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"),
      decimals: 6,
    },
    {
      key: "usdt",
      symbol: "USDT",
      address: normalizeAddress("0xdAC17F958D2ee523a2206206994597C13D831ec7"),
      decimals: 6,
    },
  ],
  arbitrum: [
    {
      key: "usdc",
      symbol: "USDC",
      address: normalizeAddress("0xaf88d065e77c8cC2239327C5EDb3A432268e5831"),
      decimals: 6,
    },
  ],
  optimism: [
    {
      key: "usdc",
      symbol: "USDC",
      address: normalizeAddress("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85"),
      decimals: 6,
    },
  ],
  base: [
    {
      key: "usdc",
      symbol: "USDC",
      address: normalizeAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"),
      decimals: 6,
    },
  ],
};

function getFallbackRpcUrl(chain: RuntimeChainDefinition): string {
  const fallback = chain.chain.rpcUrls.default.http[0];

  if (!fallback) {
    throw new Error(`No RPC URL configured for ${chain.name}. Set ${chain.envRpcKey}.`);
  }

  return fallback;
}

export class ChainRegistry {
  private readonly clients = new Map<ChainKey, PublicClient>();

  constructor(private readonly enabledChains: ChainKey[]) {}

  listEnabledChains(): Array<ChainDefinition & { defaultTokens: TokenDefinition[]; rpcConfigured: boolean }> {
    return this.enabledChains.map((key) => {
      const definition = CHAIN_REGISTRY[key];
      return {
        key: definition.key,
        chainId: definition.chainId,
        name: definition.name,
        envRpcKey: definition.envRpcKey,
        defaultConfirmations: definition.defaultConfirmations,
        maxBatchBlocks: definition.maxBatchBlocks,
        defaultTokens: DEFAULT_TOKENS[key],
        rpcConfigured: Boolean(process.env[definition.envRpcKey]),
      };
    });
  }

  getChain(key: ChainKey): ChainDefinition {
    const definition = CHAIN_REGISTRY[key];
    return {
      key: definition.key,
      chainId: definition.chainId,
      name: definition.name,
      envRpcKey: definition.envRpcKey,
      defaultConfirmations: definition.defaultConfirmations,
      maxBatchBlocks: definition.maxBatchBlocks,
    };
  }

  getDefaultTokens(key: ChainKey): TokenDefinition[] {
    return DEFAULT_TOKENS[key];
  }

  getClient(key: ChainKey): PublicClient {
    const existing = this.clients.get(key);
    if (existing) {
      return existing;
    }

    const definition = CHAIN_REGISTRY[key];
    const transportUrl = process.env[definition.envRpcKey] ?? getFallbackRpcUrl(definition);
    const client = createPublicClient({
      chain: definition.chain,
      transport: http(transportUrl),
    });

    this.clients.set(key, client);
    return client;
  }

  isEnabled(key: ChainKey): boolean {
    return this.enabledChains.includes(key);
  }

  getMaxBatchBlocks(key: ChainKey): number {
    return CHAIN_REGISTRY[key].maxBatchBlocks;
  }
}

export function addressEquals(left: Address, right: Address): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

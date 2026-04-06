import { defineChain, http, createPublicClient, type Address, type Chain, type PublicClient } from "viem";
import { arbitrum, base, bsc, mainnet, optimism, polygon } from "viem/chains";

import { normalizeAddress } from "../utils/address.js";
import type { ChainDefinition, ChainKey, TokenDefinition } from "../types.js";

interface RuntimeChainDefinition extends ChainDefinition {
  chain: Chain;
}

const megaeth = defineChain({
  id: 4326,
  name: "MegaETH",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: {
    default: { http: [] },
    public: { http: [] },
  },
});

const monad = defineChain({
  id: 143,
  name: "Monad",
  nativeCurrency: {
    name: "Monad",
    symbol: "MON",
    decimals: 18,
  },
  rpcUrls: {
    default: { http: [] },
    public: { http: [] },
  },
});

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
  polygon: {
    key: "polygon",
    chain: polygon,
    chainId: polygon.id,
    name: "Polygon",
    envRpcKey: "POLYGON_RPC_URL",
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
  optimism: {
    key: "optimism",
    chain: optimism,
    chainId: optimism.id,
    name: "Optimism",
    envRpcKey: "OPTIMISM_RPC_URL",
    defaultConfirmations: 20,
    maxBatchBlocks: 3_000,
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
  bsc: {
    key: "bsc",
    chain: bsc,
    chainId: bsc.id,
    name: "BSC",
    envRpcKey: "BSC_RPC_URL",
    defaultConfirmations: 20,
    maxBatchBlocks: 3_000,
  },
  megaeth: {
    key: "megaeth",
    chain: megaeth,
    chainId: megaeth.id,
    name: "MegaETH",
    envRpcKey: "MEGAETH_RPC_URL",
    defaultConfirmations: 20,
    maxBatchBlocks: 3_000,
  },
  monad: {
    key: "monad",
    chain: monad,
    chainId: monad.id,
    name: "Monad",
    envRpcKey: "MONAD_RPC_URL",
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
  polygon: [
    {
      key: "usdc",
      symbol: "USDC",
      address: normalizeAddress("0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"),
      decimals: 6,
    },
    {
      key: "usdt",
      symbol: "USDT",
      address: normalizeAddress("0xc2132D05D31c914a87C6611C10748AEb04B58e8F"),
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
    {
      key: "usdt",
      symbol: "USDT",
      address: normalizeAddress("0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2"),
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
    {
      key: "usdt",
      symbol: "USDT0",
      address: normalizeAddress("0x01bFF41798a0BcF287b996046Ca68b395DbC1071"),
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
    {
      key: "usdt",
      symbol: "USDT",
      address: normalizeAddress("0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9"),
      decimals: 6,
    },
  ],
  bsc: [
    {
      key: "usdc",
      symbol: "USDC",
      address: normalizeAddress("0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d"),
      decimals: 6,
    },
    {
      key: "usdt",
      symbol: "USDT",
      address: normalizeAddress("0x55d398326f99059ff775485246999027b3197955"),
      decimals: 6,
    },
  ],
  megaeth: [
    {
      key: "usdt",
      symbol: "USDT0",
      address: normalizeAddress("0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb"),
      decimals: 6,
    },
  ],
  monad: [
    {
      key: "usdc",
      symbol: "USDC",
      address: normalizeAddress("0x754704Bc059F8C67012fEd69BC8A327a5aafb603"),
      decimals: 6,
    },
    {
      key: "usdt",
      symbol: "USDT0",
      address: normalizeAddress("0xe7cd86e13AC4309349F30B3435a9d337750fC82D"),
      decimals: 6,
    },
  ],
};

interface ChainRegistryOptions {
  rpcRequestTimeoutMs?: number;
}

function getFallbackRpcUrl(chain: RuntimeChainDefinition): string {
  const fallback = chain.chain.rpcUrls.default.http[0];

  if (!fallback) {
    throw new Error(`No RPC URL configured for ${chain.name}. Set ${chain.envRpcKey}.`);
  }

  return fallback;
}

export class ChainRegistry {
  private readonly clients = new Map<ChainKey, PublicClient>();
  private readonly rpcRequestTimeoutMs: number;

  constructor(private readonly enabledChains: ChainKey[], options: ChainRegistryOptions = {}) {
    this.rpcRequestTimeoutMs = options.rpcRequestTimeoutMs ?? 5_000;
  }

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
      transport: http(transportUrl, {
        retryCount: 0,
        timeout: this.rpcRequestTimeoutMs,
      }),
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

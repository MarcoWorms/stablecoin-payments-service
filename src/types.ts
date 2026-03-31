import type { Address } from "viem";

export const SUPPORTED_CHAIN_KEYS = ["ethereum", "arbitrum", "optimism", "base"] as const;

export type ChainKey = (typeof SUPPORTED_CHAIN_KEYS)[number];

export interface TokenDefinition {
  key: string;
  symbol: string;
  address: Address;
  decimals: number;
}

export interface ChainDefinition {
  key: ChainKey;
  chainId: number;
  name: string;
  envRpcKey: string;
  defaultConfirmations: number;
  maxBatchBlocks: number;
}

export interface WatchTargetInput extends TokenDefinition {
  chainKey: ChainKey;
  confirmations: number;
  startBlock: number;
}

export interface CreateWatchInput {
  address: Address;
  label?: string | undefined;
  chains: ChainKey[];
  includeDefaultTokens: boolean;
  lookbackBlocks?: number | undefined;
  customTokens: Array<{
    chainKey: ChainKey;
    key?: string | undefined;
    symbol: string;
    address: Address;
    decimals: number;
  }>;
}

export interface WatchTargetRecord {
  id: string;
  watchId: string;
  chainKey: ChainKey;
  tokenKey: string;
  tokenSymbol: string;
  tokenAddress: Address;
  tokenDecimals: number;
  confirmations: number;
  startBlock: number;
  nextFromBlock: number;
  lastSyncedBlock: number | null;
  lastError: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WatchRecord {
  id: string;
  address: Address;
  label: string | null;
  isActive: boolean;
  dataVersion: number;
  createdAt: string;
  updatedAt: string;
  targets: WatchTargetRecord[];
}

export interface ActiveTargetRecord extends WatchTargetRecord {
  watchAddress: Address;
  watchLabel: string | null;
}

export interface PaymentRecord {
  id: string;
  watchId: string;
  targetId: string;
  chainKey: ChainKey;
  tokenKey: string;
  tokenSymbol: string;
  tokenAddress: Address;
  tokenDecimals: number;
  txHash: string;
  logIndex: number;
  blockNumber: number;
  blockHash: string | null;
  payerAddress: Address;
  recipientAddress: Address;
  rawAmount: string;
  amount: string;
  observedAt: string;
  finalizedAt: string;
}

export interface PayerSummaryRecord {
  id: string;
  watchId: string;
  chainKey: ChainKey;
  tokenKey: string;
  tokenSymbol: string;
  tokenAddress: Address;
  tokenDecimals: number;
  payerAddress: Address;
  paymentCount: number;
  totalRawAmount: string;
  totalAmount: string;
  firstPaymentAt: string;
  lastPaymentAt: string;
  lastTxHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentQuery {
  chainKey?: ChainKey | undefined;
  tokenKey?: string | undefined;
  limit: number;
  offset: number;
}

export interface PayerQuery {
  chainKey?: ChainKey | undefined;
  tokenKey?: string | undefined;
}

export interface AppConfig {
  host: string;
  port: number;
  databasePath: string;
  pollIntervalMs: number;
  httpCacheTtlMs: number;
  enabledChains: ChainKey[];
  adminUiEnabled: boolean;
}

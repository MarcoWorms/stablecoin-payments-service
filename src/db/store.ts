import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

import Database from "better-sqlite3";
import { formatUnits, type Address } from "viem";

import { normalizeAddress } from "../utils/address.js";
import { nowIso } from "../utils/time.js";
import type {
  ActiveTargetRecord,
  ChainKey,
  PaymentQuery,
  PaymentRecord,
  PayerQuery,
  PayerSummaryRecord,
  WatchRecord,
  WatchTargetInput,
  WatchTargetRecord,
} from "../types.js";

interface WatchRow {
  id: string;
  address: string;
  label: string | null;
  is_active: number;
  data_version: number;
  created_at: string;
  updated_at: string;
}

interface WatchTargetRow {
  id: string;
  watch_id: string;
  chain_key: ChainKey;
  token_key: string;
  token_symbol: string;
  token_address: string;
  token_decimals: number;
  confirmations: number;
  start_block: number;
  next_from_block: number;
  last_synced_block: number | null;
  last_error: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

interface PayerSummaryRow {
  id: string;
  watch_id: string;
  chain_key: ChainKey;
  token_key: string;
  token_symbol: string;
  token_address: string;
  token_decimals: number;
  payer_address: string;
  payment_count: number;
  total_raw_amount: string;
  total_amount: string;
  first_payment_at: string;
  last_payment_at: string;
  last_tx_hash: string;
  created_at: string;
  updated_at: string;
}

interface PaymentRow {
  id: string;
  watch_id: string;
  target_id: string;
  chain_key: ChainKey;
  token_key: string;
  token_symbol: string;
  token_address: string;
  token_decimals: number;
  tx_hash: string;
  log_index: number;
  block_number: number;
  block_hash: string | null;
  payer_address: string;
  recipient_address: string;
  raw_amount: string;
  amount: string;
  observed_at: string;
  finalized_at: string;
}

interface CreateOrUpdateWatchInput {
  address: Address;
  label?: string | undefined;
  targets: WatchTargetInput[];
}

interface RecordPaymentInput {
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
  finalizedAt: string;
}

export class DatabaseStore {
  private readonly db: Database.Database;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  createOrUpdateWatch(input: CreateOrUpdateWatchInput): WatchRecord {
    const transaction = this.db.transaction((value: CreateOrUpdateWatchInput) => {
      const now = nowIso();
      const existing = this.db
        .prepare<unknown[], WatchRow>("SELECT * FROM watches WHERE address = ?")
        .get(value.address);

      let watchId: string;

      if (existing) {
        watchId = existing.id;
        this.db
          .prepare(
            `UPDATE watches
             SET label = ?, is_active = 1, updated_at = ?
             WHERE id = ?`,
          )
          .run(value.label ?? existing.label, now, watchId);
      } else {
        watchId = randomUUID();
        this.db
          .prepare(
            `INSERT INTO watches (id, address, label, is_active, data_version, created_at, updated_at)
             VALUES (?, ?, ?, 1, 0, ?, ?)`,
          )
          .run(watchId, value.address, value.label ?? null, now, now);
      }

      const existingTargets = this.db
        .prepare<unknown[], WatchTargetRow>("SELECT * FROM watch_targets WHERE watch_id = ?")
        .all(watchId);

      const requestedKeys = new Set<string>();

      for (const target of value.targets) {
        const targetLookupKey = `${target.chainKey}:${target.address.toLowerCase()}`;
        requestedKeys.add(targetLookupKey);
        const current = existingTargets.find(
          (row) => `${row.chain_key}:${row.token_address.toLowerCase()}` === targetLookupKey,
        );

        if (current) {
          this.db
            .prepare(
              `UPDATE watch_targets
               SET token_key = ?, token_symbol = ?, token_decimals = ?, confirmations = ?, start_block = ?, next_from_block = ?, last_error = NULL, is_active = 1, updated_at = ?
               WHERE id = ?`,
            )
            .run(
              target.key,
              target.symbol,
              target.decimals,
              target.confirmations,
              target.startBlock,
              current.last_synced_block === null ? target.startBlock : current.next_from_block,
              now,
              current.id,
            );
          continue;
        }

        this.db
          .prepare(
            `INSERT INTO watch_targets (
               id, watch_id, chain_key, token_key, token_symbol, token_address, token_decimals,
               confirmations, start_block, next_from_block, last_synced_block, last_error, is_active, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 1, ?, ?)`,
          )
          .run(
            randomUUID(),
            watchId,
            target.chainKey,
            target.key,
            target.symbol,
            target.address,
            target.decimals,
            target.confirmations,
            target.startBlock,
            target.startBlock,
            now,
            now,
          );
      }

      for (const existingTarget of existingTargets) {
        const targetLookupKey = `${existingTarget.chain_key}:${existingTarget.token_address.toLowerCase()}`;
        if (requestedKeys.has(targetLookupKey)) {
          continue;
        }

        this.db
          .prepare("UPDATE watch_targets SET is_active = 0, updated_at = ? WHERE id = ?")
          .run(now, existingTarget.id);
      }

      return watchId;
    });

    const watchId = transaction(input);
    const watch = this.getWatchById(watchId);
    if (!watch) {
      throw new Error("Failed to create watch");
    }

    return watch;
  }

  deactivateWatch(watchId: string): boolean {
    const now = nowIso();
    const result = this.db
      .prepare("UPDATE watches SET is_active = 0, updated_at = ? WHERE id = ?")
      .run(now, watchId);

    this.db.prepare("UPDATE watch_targets SET is_active = 0, updated_at = ? WHERE watch_id = ?").run(now, watchId);
    return result.changes > 0;
  }

  getWatchVersion(watchId: string): number | null {
    const row = this.db
      .prepare<unknown[], Pick<WatchRow, "data_version">>("SELECT data_version FROM watches WHERE id = ?")
      .get(watchId);

    return row ? row.data_version : null;
  }

  getWatchById(watchId: string): WatchRecord | null {
    const watch = this.db.prepare<unknown[], WatchRow>("SELECT * FROM watches WHERE id = ?").get(watchId);
    if (!watch) {
      return null;
    }

    return this.mapWatchRecord(watch);
  }

  getWatchByAddress(address: Address): WatchRecord | null {
    const watch = this.db.prepare<unknown[], WatchRow>("SELECT * FROM watches WHERE address = ?").get(address);
    if (!watch) {
      return null;
    }

    return this.mapWatchRecord(watch);
  }

  listWatches(): WatchRecord[] {
    const rows = this.db.prepare<unknown[], WatchRow>("SELECT * FROM watches ORDER BY created_at DESC").all();
    return rows.map((row) => this.mapWatchRecord(row));
  }

  listActiveTargets(): ActiveTargetRecord[] {
    const rows = this.db
      .prepare<
        unknown[],
        WatchTargetRow & { watch_address: string; watch_label: string | null }
      >(
        `SELECT wt.*, w.address AS watch_address, w.label AS watch_label
         FROM watch_targets wt
         INNER JOIN watches w ON w.id = wt.watch_id
         WHERE wt.is_active = 1 AND w.is_active = 1
         ORDER BY wt.updated_at ASC`,
      )
      .all();

    return rows.map((row) => ({
      id: row.id,
      watchId: row.watch_id,
      watchAddress: normalizeAddress(row.watch_address),
      watchLabel: row.watch_label,
      chainKey: row.chain_key,
      tokenKey: row.token_key,
      tokenSymbol: row.token_symbol,
      tokenAddress: normalizeAddress(row.token_address),
      tokenDecimals: row.token_decimals,
      confirmations: row.confirmations,
      startBlock: row.start_block,
      nextFromBlock: row.next_from_block,
      lastSyncedBlock: row.last_synced_block,
      lastError: row.last_error,
      isActive: row.is_active === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  updateTargetProgress(targetId: string, nextFromBlock: number, lastSyncedBlock: number): void {
    this.db
      .prepare(
        `UPDATE watch_targets
         SET next_from_block = ?, last_synced_block = ?, last_error = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .run(nextFromBlock, lastSyncedBlock, nowIso(), targetId);
  }

  updateTargetError(targetId: string, errorMessage: string): void {
    this.db
      .prepare("UPDATE watch_targets SET last_error = ?, updated_at = ? WHERE id = ?")
      .run(errorMessage, nowIso(), targetId);
  }

  recordPayment(input: RecordPaymentInput): boolean {
    const transaction = this.db.transaction((value: RecordPaymentInput) => {
      const now = nowIso();
      const paymentId = randomUUID();
      const amount = formatUnits(BigInt(value.rawAmount), value.tokenDecimals);
      const insertResult = this.db
        .prepare(
          `INSERT OR IGNORE INTO payments (
             id, watch_id, target_id, chain_key, token_key, token_symbol, token_address, token_decimals,
             tx_hash, log_index, block_number, block_hash, payer_address, recipient_address,
             raw_amount, amount, observed_at, finalized_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          paymentId,
          value.watchId,
          value.targetId,
          value.chainKey,
          value.tokenKey,
          value.tokenSymbol,
          value.tokenAddress,
          value.tokenDecimals,
          value.txHash,
          value.logIndex,
          value.blockNumber,
          value.blockHash,
          value.payerAddress,
          value.recipientAddress,
          value.rawAmount,
          amount,
          now,
          value.finalizedAt,
        );

      if (insertResult.changes === 0) {
        return false;
      }

      const summary = this.db
        .prepare<unknown[], PayerSummaryRow>(
          `SELECT * FROM payer_summaries
           WHERE watch_id = ? AND chain_key = ? AND token_address = ? AND payer_address = ?`,
        )
        .get(value.watchId, value.chainKey, value.tokenAddress, value.payerAddress);

      if (summary) {
        const nextRawTotal = (BigInt(summary.total_raw_amount) + BigInt(value.rawAmount)).toString();
        this.db
          .prepare(
            `UPDATE payer_summaries
             SET payment_count = ?, total_raw_amount = ?, total_amount = ?, last_payment_at = ?, last_tx_hash = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(
            summary.payment_count + 1,
            nextRawTotal,
            formatUnits(BigInt(nextRawTotal), value.tokenDecimals),
            value.finalizedAt,
            value.txHash,
            now,
            summary.id,
          );
      } else {
        this.db
          .prepare(
            `INSERT INTO payer_summaries (
               id, watch_id, chain_key, token_key, token_symbol, token_address, token_decimals,
               payer_address, payment_count, total_raw_amount, total_amount, first_payment_at,
               last_payment_at, last_tx_hash, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            randomUUID(),
            value.watchId,
            value.chainKey,
            value.tokenKey,
            value.tokenSymbol,
            value.tokenAddress,
            value.tokenDecimals,
            value.payerAddress,
            value.rawAmount,
            amount,
            value.finalizedAt,
            value.finalizedAt,
            value.txHash,
            now,
            now,
          );
      }

      this.db
        .prepare("UPDATE watches SET data_version = data_version + 1, updated_at = ? WHERE id = ?")
        .run(now, value.watchId);

      return true;
    });

    return transaction(input);
  }

  getPayerSummaries(watchId: string, query: PayerQuery): PayerSummaryRecord[] {
    const conditions = ["watch_id = ?"];
    const params: Array<string | number> = [watchId];

    if (query.chainKey) {
      conditions.push("chain_key = ?");
      params.push(query.chainKey);
    }

    if (query.tokenKey) {
      conditions.push("token_key = ?");
      params.push(query.tokenKey);
    }

    const rows = this.db
      .prepare<unknown[], PayerSummaryRow>(
        `SELECT * FROM payer_summaries
         WHERE ${conditions.join(" AND ")}
         ORDER BY last_payment_at DESC, payment_count DESC`,
      )
      .all(...params);

    return rows.map((row) => ({
      id: row.id,
      watchId: row.watch_id,
      chainKey: row.chain_key,
      tokenKey: row.token_key,
      tokenSymbol: row.token_symbol,
      tokenAddress: normalizeAddress(row.token_address),
      tokenDecimals: row.token_decimals,
      payerAddress: normalizeAddress(row.payer_address),
      paymentCount: row.payment_count,
      totalRawAmount: row.total_raw_amount,
      totalAmount: row.total_amount,
      firstPaymentAt: row.first_payment_at,
      lastPaymentAt: row.last_payment_at,
      lastTxHash: row.last_tx_hash,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  getPayments(watchId: string, query: PaymentQuery): PaymentRecord[] {
    const conditions = ["watch_id = ?"];
    const params: Array<string | number> = [watchId];

    if (query.chainKey) {
      conditions.push("chain_key = ?");
      params.push(query.chainKey);
    }

    if (query.tokenKey) {
      conditions.push("token_key = ?");
      params.push(query.tokenKey);
    }

    params.push(query.limit, query.offset);

    const rows = this.db
      .prepare<unknown[], PaymentRow>(
        `SELECT * FROM payments
         WHERE ${conditions.join(" AND ")}
         ORDER BY finalized_at DESC, block_number DESC, log_index DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params);

    return rows.map((row) => ({
      id: row.id,
      watchId: row.watch_id,
      targetId: row.target_id,
      chainKey: row.chain_key,
      tokenKey: row.token_key,
      tokenSymbol: row.token_symbol,
      tokenAddress: normalizeAddress(row.token_address),
      tokenDecimals: row.token_decimals,
      txHash: row.tx_hash,
      logIndex: row.log_index,
      blockNumber: row.block_number,
      blockHash: row.block_hash,
      payerAddress: normalizeAddress(row.payer_address),
      recipientAddress: normalizeAddress(row.recipient_address),
      rawAmount: row.raw_amount,
      amount: row.amount,
      observedAt: row.observed_at,
      finalizedAt: row.finalized_at,
    }));
  }

  private mapWatchRecord(watch: WatchRow): WatchRecord {
    const targets = this.db
      .prepare<unknown[], WatchTargetRow>(
        `SELECT * FROM watch_targets
         WHERE watch_id = ?
         ORDER BY chain_key ASC, token_symbol ASC`,
      )
      .all(watch.id);

    return {
      id: watch.id,
      address: normalizeAddress(watch.address),
      label: watch.label,
      isActive: watch.is_active === 1,
      dataVersion: watch.data_version,
      createdAt: watch.created_at,
      updatedAt: watch.updated_at,
      targets: targets.map((target) => this.mapTargetRow(target)),
    };
  }

  private mapTargetRow(row: WatchTargetRow): WatchTargetRecord {
    return {
      id: row.id,
      watchId: row.watch_id,
      chainKey: row.chain_key,
      tokenKey: row.token_key,
      tokenSymbol: row.token_symbol,
      tokenAddress: normalizeAddress(row.token_address),
      tokenDecimals: row.token_decimals,
      confirmations: row.confirmations,
      startBlock: row.start_block,
      nextFromBlock: row.next_from_block,
      lastSyncedBlock: row.last_synced_block,
      lastError: row.last_error,
      isActive: row.is_active === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS watches (
        id TEXT PRIMARY KEY,
        address TEXT NOT NULL UNIQUE,
        label TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        data_version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS watch_targets (
        id TEXT PRIMARY KEY,
        watch_id TEXT NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
        chain_key TEXT NOT NULL,
        token_key TEXT NOT NULL,
        token_symbol TEXT NOT NULL,
        token_address TEXT NOT NULL,
        token_decimals INTEGER NOT NULL,
        confirmations INTEGER NOT NULL,
        start_block INTEGER NOT NULL,
        next_from_block INTEGER NOT NULL,
        last_synced_block INTEGER,
        last_error TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(watch_id, chain_key, token_address)
      );

      CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY,
        watch_id TEXT NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
        target_id TEXT NOT NULL REFERENCES watch_targets(id) ON DELETE CASCADE,
        chain_key TEXT NOT NULL,
        token_key TEXT NOT NULL,
        token_symbol TEXT NOT NULL,
        token_address TEXT NOT NULL,
        token_decimals INTEGER NOT NULL,
        tx_hash TEXT NOT NULL,
        log_index INTEGER NOT NULL,
        block_number INTEGER NOT NULL,
        block_hash TEXT,
        payer_address TEXT NOT NULL,
        recipient_address TEXT NOT NULL,
        raw_amount TEXT NOT NULL,
        amount TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        finalized_at TEXT NOT NULL,
        UNIQUE(target_id, tx_hash, log_index)
      );

      CREATE TABLE IF NOT EXISTS payer_summaries (
        id TEXT PRIMARY KEY,
        watch_id TEXT NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
        chain_key TEXT NOT NULL,
        token_key TEXT NOT NULL,
        token_symbol TEXT NOT NULL,
        token_address TEXT NOT NULL,
        token_decimals INTEGER NOT NULL,
        payer_address TEXT NOT NULL,
        payment_count INTEGER NOT NULL,
        total_raw_amount TEXT NOT NULL,
        total_amount TEXT NOT NULL,
        first_payment_at TEXT NOT NULL,
        last_payment_at TEXT NOT NULL,
        last_tx_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(watch_id, chain_key, token_address, payer_address)
      );

      CREATE INDEX IF NOT EXISTS idx_watch_targets_sync
        ON watch_targets(is_active, chain_key, next_from_block);

      CREATE INDEX IF NOT EXISTS idx_payments_watch_order
        ON payments(watch_id, finalized_at DESC);

      CREATE INDEX IF NOT EXISTS idx_payer_summaries_watch_order
        ON payer_summaries(watch_id, last_payment_at DESC);
    `);
  }
}

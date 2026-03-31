import { z } from "zod";

import { SUPPORTED_CHAIN_KEYS, type AppConfig, type ChainKey } from "./types.js";

const envSchema = z.object({
  HOST: z.string().trim().min(1).optional(),
  PORT: z.coerce.number().int().min(1).max(65535).optional(),
  DATABASE_PATH: z.string().trim().min(1).optional(),
  POLL_INTERVAL_MS: z.coerce.number().int().min(5_000).max(300_000).optional(),
  HTTP_CACHE_TTL_MS: z.coerce.number().int().min(1_000).max(60_000).optional(),
  ENABLED_CHAINS: z.string().trim().optional(),
  ADMIN_UI_ENABLED: z.string().trim().optional(),
});

export function loadConfig(): AppConfig {
  const parsed = envSchema.parse(process.env);
  const enabledChains = parseEnabledChains(parsed.ENABLED_CHAINS);

  return {
    host: parsed.HOST ?? "0.0.0.0",
    port: parsed.PORT ?? 3000,
    databasePath: parsed.DATABASE_PATH ?? "./data/stablecoin-payments.db",
    pollIntervalMs: parsed.POLL_INTERVAL_MS ?? 15_000,
    httpCacheTtlMs: parsed.HTTP_CACHE_TTL_MS ?? 5_000,
    enabledChains,
    adminUiEnabled: parsed.ADMIN_UI_ENABLED === undefined ? true : parsed.ADMIN_UI_ENABLED !== "false",
  };
}

function parseEnabledChains(raw: string | undefined): ChainKey[] {
  if (!raw || raw.trim().length === 0) {
    return [...SUPPORTED_CHAIN_KEYS];
  }

  const requested = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);

  const invalid = requested.filter((value) => !SUPPORTED_CHAIN_KEYS.includes(value as ChainKey));
  if (invalid.length > 0) {
    throw new Error(`Unsupported chain keys in ENABLED_CHAINS: ${invalid.join(", ")}`);
  }

  return requested as ChainKey[];
}

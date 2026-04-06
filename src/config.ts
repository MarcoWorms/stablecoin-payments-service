import { z } from "zod";

import { SUPPORTED_CHAIN_KEYS, type AppConfig, type ChainKey } from "./types.js";

const envSchema = z.object({
  HOST: z.string().trim().min(1).optional(),
  PORT: z.coerce.number().int().min(1).max(65535).optional(),
  DATABASE_PATH: z.string().trim().min(1).optional(),
  POLL_INTERVAL_MS: z.coerce.number().int().min(5_000).max(300_000).optional(),
  RPC_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(250).max(60_000).optional(),
  TARGET_ERROR_RETRY_MS: z.coerce.number().int().min(1_000).max(900_000).optional(),
  HTTP_CACHE_TTL_MS: z.coerce.number().int().min(1_000).max(60_000).optional(),
  CACHE_MAX_ENTRIES: z.coerce.number().int().min(16).max(10_000).optional(),
  BODY_LIMIT_KB: z.coerce.number().int().min(16).max(1_024).optional(),
  ENABLED_CHAINS: z.string().trim().optional(),
  ADMIN_UI_ENABLED: z.string().trim().optional(),
  AUTH_TOKENS: z.string().trim().optional(),
  ALLOW_INSECURE_NO_AUTH_IN_PRODUCTION: z.string().trim().optional(),
  ALLOWED_ORIGINS: z.string().trim().optional(),
});

export function loadConfig(): AppConfig {
  const parsed = envSchema.parse(process.env);
  const enabledChains = parseEnabledChains(parsed.ENABLED_CHAINS);
  const authTokens = parseCommaSeparatedValues(parsed.AUTH_TOKENS);
  const allowedOrigins = parseAllowedOrigins(parsed.ALLOWED_ORIGINS);
  const allowInsecureNoAuthInProduction =
    parsed.ALLOW_INSECURE_NO_AUTH_IN_PRODUCTION !== undefined &&
    parsed.ALLOW_INSECURE_NO_AUTH_IN_PRODUCTION !== "false";

  if (process.env.NODE_ENV === "production" && authTokens.length === 0 && !allowInsecureNoAuthInProduction) {
    throw new Error(
      "Refusing to start in production without AUTH_TOKENS. Set AUTH_TOKENS or ALLOW_INSECURE_NO_AUTH_IN_PRODUCTION=true.",
    );
  }

  return {
    host: parsed.HOST ?? "0.0.0.0",
    port: parsed.PORT ?? 3000,
    databasePath: parsed.DATABASE_PATH ?? "./data/stablecoin-payments.db",
    pollIntervalMs: parsed.POLL_INTERVAL_MS ?? 15_000,
    rpcRequestTimeoutMs: parsed.RPC_REQUEST_TIMEOUT_MS ?? 5_000,
    targetErrorRetryMs: parsed.TARGET_ERROR_RETRY_MS ?? 60_000,
    httpCacheTtlMs: parsed.HTTP_CACHE_TTL_MS ?? 5_000,
    cacheMaxEntries: parsed.CACHE_MAX_ENTRIES ?? 256,
    bodyLimitBytes: (parsed.BODY_LIMIT_KB ?? 64) * 1024,
    enabledChains,
    adminUiEnabled: parsed.ADMIN_UI_ENABLED === undefined ? true : parsed.ADMIN_UI_ENABLED !== "false",
    allowedOrigins,
    authTokens,
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

function parseCommaSeparatedValues(raw: string | undefined): string[] {
  if (!raw || raw.trim().length === 0) {
    return [];
  }

  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function parseAllowedOrigins(raw: string | undefined): string[] {
  const origins = parseCommaSeparatedValues(raw);

  if (origins.includes("*")) {
    throw new Error("ALLOWED_ORIGINS must be explicit. Wildcard origins are not allowed.");
  }

  return origins;
}

import { resolve } from "node:path";

import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { z, ZodError } from "zod";

import { ChainRegistry } from "./chains/registry.js";
import { loadConfig } from "./config.js";
import { DatabaseStore } from "./db/store.js";
import { MonitorService } from "./services/monitor-service.js";
import { WatchService } from "./services/watch-service.js";
import { isAuthorized } from "./utils/auth.js";
import { ResponseCache } from "./utils/cache.js";
import { buildFilterKey, buildPayerListEtag } from "./utils/etag.js";
import { toSafeErrorMessage } from "./utils/errors.js";
import { normalizeAddress } from "./utils/address.js";
import { nowIso } from "./utils/time.js";
import { SUPPORTED_CHAIN_KEYS, type AppConfig } from "./types.js";

const chainKeySchema = z.enum(SUPPORTED_CHAIN_KEYS);
const safeDisplayString = z.string().trim().min(1).max(120).regex(/^[^\u0000-\u001F\u007F]*$/u);
const safeTokenKey = z.string().trim().min(1).max(64).regex(/^[a-z0-9._-]+$/i);
const safeTokenSymbol = z.string().trim().min(1).max(20).regex(/^[A-Z0-9._-]+$/i);

const createWatchBodySchema = z.object({
  address: z.string().trim(),
  label: safeDisplayString.optional(),
  chains: z
    .array(chainKeySchema)
    .min(1)
    .max(SUPPORTED_CHAIN_KEYS.length)
    .superRefine((chains, ctx) => {
      if (new Set(chains).size !== chains.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Chains must be unique",
        });
      }
    }),
  includeDefaultTokens: z.boolean().optional().default(true),
  lookbackBlocks: z.coerce.number().int().min(0).max(250_000).optional(),
  customTokens: z
    .array(
      z.object({
        chainKey: chainKeySchema,
        key: safeTokenKey.optional(),
        symbol: safeTokenSymbol,
        address: z.string().trim(),
        decimals: z.number().int().min(0).max(36),
      }),
    )
    .max(32)
    .optional()
    .default([])
    .superRefine((tokens, ctx) => {
      const seen = new Set<string>();

      for (const token of tokens) {
        const key = `${token.chainKey}:${token.address.toLowerCase()}`;
        if (seen.has(key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate custom token definition for ${token.chainKey}:${token.address}`,
          });
        }
        seen.add(key);
      }
    }),
});

const listQuerySchema = z.object({
  chainKey: chainKeySchema.optional(),
  tokenKey: safeTokenKey.optional(),
});

const paymentsQuerySchema = listQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(500).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export interface AppContext {
  app: FastifyInstance;
  monitor: MonitorService;
  store: DatabaseStore;
  config: AppConfig;
}

export async function createApp(config: AppConfig = loadConfig()): Promise<AppContext> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
    bodyLimit: config.bodyLimitBytes,
  });

  const store = new DatabaseStore(config.databasePath);
  const registry = new ChainRegistry(config.enabledChains, {
    rpcRequestTimeoutMs: config.rpcRequestTimeoutMs,
  });
  const watchService = new WatchService(store, registry, app.log, config.rpcRequestTimeoutMs);
  const payersCache = new ResponseCache<unknown>(config.httpCacheTtlMs, config.cacheMaxEntries);
  const monitor = new MonitorService(store, registry, app.log, config.pollIntervalMs, {
    rpcRequestTimeoutMs: config.rpcRequestTimeoutMs,
    targetErrorRetryMs: config.targetErrorRetryMs,
  });

  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: config.adminUiEnabled
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'"],
            imgSrc: ["'self'", "data:"],
            connectSrc: ["'self'"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            frameAncestors: ["'none'"],
          },
        }
      : false,
    crossOriginEmbedderPolicy: false,
  });

  if (config.allowedOrigins.length > 0) {
    await app.register(cors, {
      origin: (origin, callback) => {
        if (!origin) {
          callback(null, true);
          return;
        }

        callback(null, config.allowedOrigins.includes(origin));
      },
    });
  }

  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/v1/") || request.url === "/v1/health") {
      return;
    }

    if (isAuthorized(request.headers, config.authTokens)) {
      return;
    }

    reply
      .code(401)
      .header("WWW-Authenticate", 'Bearer realm="stablecoin-payments-service"')
      .send({ error: "Unauthorized" });
  });

  if (config.adminUiEnabled) {
    await app.register(fastifyStatic, {
      root: resolve(process.cwd(), "public"),
      prefix: "/ui/",
      index: ["index.html"],
    });

    app.get("/", async (_request, reply) => {
      reply.redirect("/ui/");
    });
  }

  app.get("/v1/health", async () => ({
    status: "ok",
    timestamp: nowIso(),
    enabledChains: config.enabledChains,
    authEnabled: config.authTokens.length > 0,
  }));

  app.get("/v1/registry", async () => ({
    chains: registry.listEnabledChains(),
  }));

  app.get("/v1/watches", async () => ({
    items: store.listWatches(),
  }));

  app.post("/v1/watches", async (request, reply) => {
    const body = createWatchBodySchema.parse(request.body);
    const watch = await watchService.upsertWatch({
      address: normalizeAddress(body.address),
      label: body.label,
      chains: body.chains,
      includeDefaultTokens: body.includeDefaultTokens,
      lookbackBlocks: body.lookbackBlocks,
      customTokens: body.customTokens.map((token) => ({
        chainKey: token.chainKey,
        ...(token.key ? { key: token.key } : {}),
        symbol: token.symbol,
        address: normalizeAddress(token.address),
        decimals: token.decimals,
      })),
    });

    reply.code(201);
    return watch;
  });

  app.get("/v1/watches/:watchId", async (request, reply) => {
    const params = z.object({ watchId: z.string().uuid() }).parse(request.params);
    const watch = store.getWatchById(params.watchId);

    if (!watch) {
      reply.code(404);
      return { error: "Watch not found" };
    }

    return watch;
  });

  app.delete("/v1/watches/:watchId", async (request, reply) => {
    const params = z.object({ watchId: z.string().uuid() }).parse(request.params);
    const removed = store.deactivateWatch(params.watchId);

    if (!removed) {
      reply.code(404);
      return { error: "Watch not found" };
    }

    return { ok: true };
  });

  app.get("/v1/watches/by-address/:address", async (request, reply) => {
    const params = z.object({ address: z.string().trim() }).parse(request.params);
    const watch = store.getWatchByAddress(normalizeAddress(params.address));

    if (!watch) {
      reply.code(404);
      return { error: "Watch not found" };
    }

    return watch;
  });

  app.get("/v1/watches/:watchId/payers", async (request, reply) => {
    const params = z.object({ watchId: z.string().uuid() }).parse(request.params);
    const query = listQuerySchema.parse(request.query);
    const watch = store.getWatchById(params.watchId);

    if (!watch) {
      reply.code(404);
      return { error: "Watch not found" };
    }

    const filterKey = buildFilterKey(query);
    const dataVersion = store.getWatchVersion(params.watchId) ?? 0;
    const etag = buildPayerListEtag(dataVersion, filterKey);

    reply.header("ETag", etag);
    reply.header("Cache-Control", "private, max-age=0, must-revalidate");

    const ifNoneMatch = request.headers["if-none-match"];
    if (ifNoneMatch === etag) {
      reply.code(304);
      return reply.send();
    }

    const cacheKey = `${params.watchId}:${filterKey}`;
    const cached = payersCache.get(cacheKey, etag);
    if (cached) {
      return cached;
    }

    const payers = store.getPayerSummaries(params.watchId, query);
    const payload = {
      watchId: params.watchId,
      dataVersion,
      chainKey: query.chainKey ?? null,
      tokenKey: query.tokenKey ?? null,
      count: payers.length,
      items: payers,
    };

    payersCache.set(cacheKey, etag, payload);
    return payload;
  });

  app.get("/v1/watches/:watchId/payments", async (request, reply) => {
    const params = z.object({ watchId: z.string().uuid() }).parse(request.params);
    const query = paymentsQuerySchema.parse(request.query);
    const watch = store.getWatchById(params.watchId);

    if (!watch) {
      reply.code(404);
      return { error: "Watch not found" };
    }

    return {
      watchId: params.watchId,
      ...query,
      items: store.getPayments(params.watchId, query),
    };
  });

  app.setErrorHandler((error, _request, reply) => {
    app.log.error({ err: error }, "Request failed");

    const statusCode =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : 400;

    const isValidationError = error instanceof ZodError;
    const responseMessage =
      statusCode >= 500
        ? "Internal server error"
        : isValidationError
          ? "Invalid request"
          : toSafeErrorMessage(error, "Request failed");

    reply.code(statusCode).send({
      error: responseMessage,
      ...(isValidationError
        ? {
            details: error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          }
        : {}),
    });
  });

  app.addHook("onClose", async () => {
    monitor.stop();
    store.close();
  });

  return {
    app,
    monitor,
    store,
    config,
  };
}

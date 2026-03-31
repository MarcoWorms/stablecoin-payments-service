import { resolve } from "node:path";

import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";

import { ChainRegistry } from "./chains/registry.js";
import { loadConfig } from "./config.js";
import { DatabaseStore } from "./db/store.js";
import { MonitorService } from "./services/monitor-service.js";
import { WatchService } from "./services/watch-service.js";
import { ResponseCache } from "./utils/cache.js";
import { buildFilterKey, buildPayerListEtag } from "./utils/etag.js";
import { normalizeAddress } from "./utils/address.js";
import { nowIso } from "./utils/time.js";
import { SUPPORTED_CHAIN_KEYS, type AppConfig, type ChainKey } from "./types.js";

const chainKeySchema = z.enum(SUPPORTED_CHAIN_KEYS);

const createWatchBodySchema = z.object({
  address: z.string().trim(),
  label: z.string().trim().max(120).optional(),
  chains: z.array(chainKeySchema).min(1),
  includeDefaultTokens: z.boolean().optional().default(true),
  lookbackBlocks: z.coerce.number().int().min(0).max(2_000_000).optional(),
  customTokens: z
    .array(
      z.object({
        chainKey: chainKeySchema,
        key: z.string().trim().max(64).optional(),
        symbol: z.string().trim().min(1).max(20),
        address: z.string().trim(),
        decimals: z.number().int().min(0).max(36),
      }),
    )
    .optional()
    .default([]),
});

const listQuerySchema = z.object({
  chainKey: chainKeySchema.optional(),
  tokenKey: z.string().trim().min(1).max(64).optional(),
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
  });

  const store = new DatabaseStore(config.databasePath);
  const registry = new ChainRegistry(config.enabledChains);
  const watchService = new WatchService(store, registry, app.log);
  const payersCache = new ResponseCache<unknown>(config.httpCacheTtlMs);
  const monitor = new MonitorService(store, registry, app.log, config.pollIntervalMs);

  await app.register(cors, {
    origin: true,
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
    const message = error instanceof Error ? error.message : String(error);
    const statusCode =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : 400;
    reply.code(statusCode).send({
      error: message,
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

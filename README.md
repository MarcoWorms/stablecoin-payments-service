# stablecoin-payments-service

Open-source drop-in infrastructure for keeping a reliable "this address has paid" ledger for EVM stablecoin transfers.

The service exposes a small HTTP API and built-in admin UI. You deploy it, enable the EVM chains you want, paste the wallet address you want to watch, and the service keeps a persistent ledger of finalized incoming stablecoin transfers. Consumers can fetch the payer list with ETag-based conditional requests, so unchanged lists return `304 Not Modified`.

## What it does

- Watches incoming ERC-20 `Transfer` events for selected wallets.
- Tracks finalized payments only by waiting for a per-chain confirmation buffer.
- Stores every finalized payment in SQLite and maintains an aggregated payer summary table.
- Exposes endpoints for watches, payers, payments, and supported chain/token presets.
- Ships with a small built-in `/ui/` control panel for pasting addresses and inspecting who paid.

## Starter defaults

This repo ships with chain presets for:

- Ethereum
- Arbitrum
- Optimism
- Base

And default token presets for:

- USDC on Ethereum, Arbitrum, Optimism, and Base
- USDT on Ethereum

You can add more tokens per chain without code changes by sending `customTokens` in the watch creation API. That is the safest path for bridged or ecosystem-specific variants.

## Why this shape

The service is optimized for a simple deployment model:

- One Node service
- One local SQLite database
- One polling worker loop
- A cheap read API with response caching and `ETag`

That makes it easy to run on a VM, Fly.io machine, Railway container, Render service, or Docker host without introducing Redis, Kafka, or a second worker process.

## Quick start

### Local

```bash
cp .env.example .env
pnpm install
pnpm dev
```

Open [http://localhost:3000/ui/](http://localhost:3000/ui/).

### Docker

```bash
cp .env.example .env
docker compose up --build
```

The SQLite file will live under `./data`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | HTTP bind host |
| `PORT` | `3000` | HTTP port |
| `DATABASE_PATH` | `./data/stablecoin-payments.db` | SQLite file path |
| `POLL_INTERVAL_MS` | `15000` | Background sync cadence |
| `HTTP_CACHE_TTL_MS` | `5000` | In-process cache TTL for repeated read responses |
| `ENABLED_CHAINS` | `ethereum,arbitrum,optimism,base` | Comma-separated enabled chain list |
| `ADMIN_UI_ENABLED` | `true` | Serve the built-in `/ui/` panel |
| `ETHEREUM_RPC_URL` | empty | Optional dedicated RPC URL |
| `ARBITRUM_RPC_URL` | empty | Optional dedicated RPC URL |
| `OPTIMISM_RPC_URL` | empty | Optional dedicated RPC URL |
| `BASE_RPC_URL` | empty | Optional dedicated RPC URL |

If no RPC URL is set for an enabled chain, the service falls back to the chain definition bundled with `viem`. That is useful for quick local testing, but production deployments should use dedicated RPC providers.

## API

### List enabled chains and default token presets

```bash
curl http://localhost:3000/v1/registry
```

### Create or replace a watch

This request watches the same wallet on Ethereum, Arbitrum, Optimism, and Base using the repo's default token presets.

```bash
curl -X POST http://localhost:3000/v1/watches \
  -H 'content-type: application/json' \
  -d '{
    "address": "0xYourWallet",
    "label": "Treasury",
    "chains": ["ethereum", "arbitrum", "optimism", "base"],
    "includeDefaultTokens": true
  }'
```

If you want to backfill recent history instead of starting only with new payments, add `lookbackBlocks`:

```json
{
  "address": "0xYourWallet",
  "chains": ["ethereum"],
  "includeDefaultTokens": true,
  "lookbackBlocks": 5000
}
```

### Add custom tokens

```bash
curl -X POST http://localhost:3000/v1/watches \
  -H 'content-type: application/json' \
  -d '{
    "address": "0xYourWallet",
    "chains": ["base"],
    "includeDefaultTokens": true,
    "customTokens": [
      {
        "chainKey": "base",
        "symbol": "USDT",
        "address": "0xTokenAddress",
        "decimals": 6
      }
    ]
  }'
```

### Fetch the payer list

```bash
curl http://localhost:3000/v1/watches/<watch-id>/payers
```

The response includes an `ETag`. Re-send it with `If-None-Match` to get `304 Not Modified` when the list has not changed:

```bash
curl http://localhost:3000/v1/watches/<watch-id>/payers \
  -H 'If-None-Match: "payers:1:all:all"'
```

### Fetch raw payments

```bash
curl 'http://localhost:3000/v1/watches/<watch-id>/payments?limit=100'
```

## Data model

The SQLite database keeps four tables:

- `watches`: one watched recipient address
- `watch_targets`: chain + token monitors attached to a watch
- `payments`: every finalized transfer event recorded for a watch target
- `payer_summaries`: aggregated totals by payer address, chain, and token

## Operational notes

- Finality is implemented as confirmation buffers per chain. The defaults are conservative enough for a lightweight service, but still confirmation-based rather than consensus-finality proofs.
- This repo is designed for one active polling instance per database. Running several replicas against the same SQLite file is not supported.
- SQLite is the right default for a single deployment, but the persistence layer is isolated in `src/db/store.ts` if you want to swap it for Postgres.

## Development

```bash
pnpm install
pnpm check
```

## Roadmap ideas

- Split API and worker roles for horizontal scaling
- Postgres backend
- Webhooks when a new payer appears
- Explicit per-chain confirmation overrides
- Exporters for CSV and signed snapshots

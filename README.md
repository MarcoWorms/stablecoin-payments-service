# stablecoin-payments-service

Drop-in infrastructure for one job:

track finalized stablecoin payments to one or more EVM wallet addresses, persist the results, and expose a reliable "who has paid me?" API.

---

## TL;DR

If you only want the fastest path from zero to working:

1. Start the service.

```bash
cp .env.example .env
docker compose up --build
```

2. Open the built-in UI at [http://localhost:3000/ui/](http://localhost:3000/ui/).

3. Paste the wallet address you want to watch and select chains.

4. Fetch the payer list from:

```bash
curl http://localhost:3000/v1/watches/<watch-id>/payers
```

If nothing changed since your last fetch, re-send the `ETag` with `If-None-Match` and the service returns `304 Not Modified`.

---

## What This Service Is

This repo gives you a deployable service that:

- watches incoming ERC-20 stablecoin transfers to addresses you choose
- waits for a confirmation buffer before treating the payment as final
- stores both raw payment events and aggregated payer totals in SQLite
- exposes a small HTTP API for reads and writes
- includes a minimal built-in admin UI so users can paste a wallet address without building a separate frontend

This is meant to be the boring, reliable backend piece behind flows like:

- "unlock a feature if this address has paid"
- "show me everyone who paid this treasury wallet"
- "build a lightweight stablecoin payment inbox"
- "sync payer data into my app without running my own chain indexer"

---

## What You Get

- Fastify API
- background EVM poller using `viem`
- SQLite persistence
- ETag-based cache validation on the payer list
- Dockerfile and `compose.yaml`
- CI workflow
- tests for aggregation and conditional cache behavior
- built-in `/ui/` admin panel

---

## Default Chain And Token Presets

### Chains

- Ethereum
- Arbitrum
- Optimism
- Base

### Default tokens

- USDC on Ethereum, Arbitrum, Optimism, and Base
- USDT on Ethereum

If you need additional tokens, including bridged or ecosystem-specific variants, add them with `customTokens` when creating the watch.

That is the intended extension path. The repo is opinionated about safe defaults, but not locked down.

---

## Mental Model

The service has four core concepts:

### 1. Watch

A watch is one recipient wallet address you care about.

Example:

- `0xYourTreasuryWallet`

### 2. Watch target

A watch target is one chain + token pair attached to that watch.

Example:

- Ethereum + USDC
- Base + USDC
- Ethereum + USDT

### 3. Payment

A payment is one finalized ERC-20 `Transfer` event into the watched address.

### 4. Payer summary

A payer summary is the aggregated view you probably want for app logic:

- payer address
- token
- chain
- total amount paid
- number of payments
- first payment time
- last payment time

If your product only needs "has this address paid?" or "how much has this address paid?", this is the main read model.

---

## Zero To Running Service

### Prerequisites

- Node 20+ if you want to run it directly
- or Docker if you want the easiest deployment path
- ideally dedicated RPC URLs for each chain you enable

### Option A: Docker

```bash
cp .env.example .env
docker compose up --build
```

This is the quickest way to get a production-shaped local instance.

The database file will be stored in:

```text
./data/stablecoin-payments.db
```

### Option B: Run directly with pnpm

```bash
cp .env.example .env
pnpm install
pnpm dev
```

Open:

- UI: [http://localhost:3000/ui/](http://localhost:3000/ui/)
- health check: [http://localhost:3000/v1/health](http://localhost:3000/v1/health)

---

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | HTTP bind host |
| `PORT` | `3000` | HTTP port |
| `DATABASE_PATH` | `./data/stablecoin-payments.db` | SQLite file path |
| `POLL_INTERVAL_MS` | `15000` | How often the background worker checks chains |
| `HTTP_CACHE_TTL_MS` | `5000` | Short in-process cache TTL for repeated reads |
| `ENABLED_CHAINS` | `ethereum,arbitrum,optimism,base` | Comma-separated enabled chains |
| `ADMIN_UI_ENABLED` | `true` | Whether to serve the built-in UI |
| `ETHEREUM_RPC_URL` | empty | Dedicated RPC URL for Ethereum |
| `ARBITRUM_RPC_URL` | empty | Dedicated RPC URL for Arbitrum |
| `OPTIMISM_RPC_URL` | empty | Dedicated RPC URL for Optimism |
| `BASE_RPC_URL` | empty | Dedicated RPC URL for Base |

### Important note about RPCs

If you do not set a dedicated RPC URL, the service falls back to the chain definition bundled with `viem`.

That is fine for quick local testing.

For real usage, use dedicated RPC endpoints.

---

## Zero To First Watch

You have two ways to add a watch:

- use the built-in UI
- call the API directly

### Using the built-in UI

1. Open `/ui/`
2. Paste the wallet address you want to watch
3. Select one or more chains
4. Keep "Include default stablecoin presets" checked unless you want custom-only behavior
5. Save the watch

### Using the API

This creates or updates a watch for one address and monitors the default stablecoin presets on the selected chains:

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

The response contains the durable `watch.id` you will use for reads:

```json
{
  "id": "8b9b2f2a-9f49-44d4-8e88-3d3916f7a1d2",
  "address": "0xYourWallet",
  "label": "Treasury",
  "targets": [
    {
      "chainKey": "ethereum",
      "tokenKey": "usdc"
    }
  ]
}
```

### Important behavior

`POST /v1/watches` is an upsert.

For the same wallet address:

- it reuses the existing watch
- it replaces the active target set to match the new request
- it re-enables matching targets that already exist
- it deactivates old targets that are no longer requested

That keeps the API simple and makes the UI easy to reason about.

### If you did not store the watch ID

You can recover it by watched address:

```bash
curl http://localhost:3000/v1/watches/by-address/0xYourWallet
```

---

## Backfilling Existing Payments

By default, a new watch starts from "now" and only records new finalized payments going forward.

If you want to catch recent history, send `lookbackBlocks`:

```bash
curl -X POST http://localhost:3000/v1/watches \
  -H 'content-type: application/json' \
  -d '{
    "address": "0xYourWallet",
    "chains": ["ethereum"],
    "includeDefaultTokens": true,
    "lookbackBlocks": 5000
  }'
```

Use this when:

- you are onboarding an already-used treasury wallet
- you want a recent audit window immediately
- you do not want to index the full lifetime of an address

---

## Adding Custom Tokens

If the default token list is not enough, attach extra tokens with `customTokens`.

Example:

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

Use `includeDefaultTokens: false` if you want a custom-token-only watch definition.

---

## Reading The Data

There are two main read endpoints:

### 1. Aggregated payer list

This is the endpoint most apps should use:

```bash
curl http://localhost:3000/v1/watches/<watch-id>/payers
```

It returns a compact list of:

- payer address
- chain
- token
- total amount
- number of payments
- first payment timestamp
- last payment timestamp

Example:

```json
{
  "watchId": "8b9b2f2a-9f49-44d4-8e88-3d3916f7a1d2",
  "count": 1,
  "items": [
    {
      "payerAddress": "0xPayer",
      "chainKey": "ethereum",
      "tokenKey": "usdc",
      "tokenSymbol": "USDC",
      "totalAmount": "150",
      "paymentCount": 2
    }
  ]
}
```

### 2. Raw payment events

Use this when you need a full audit trail:

```bash
curl 'http://localhost:3000/v1/watches/<watch-id>/payments?limit=100'
```

This returns the underlying finalized payment records.

---

## Filtering Reads

Both `/payers` and `/payments` support filters.

Examples:

```bash
curl 'http://localhost:3000/v1/watches/<watch-id>/payers?chainKey=ethereum'
curl 'http://localhost:3000/v1/watches/<watch-id>/payers?tokenKey=usdc'
curl 'http://localhost:3000/v1/watches/<watch-id>/payments?chainKey=base&tokenKey=usdc&limit=50'
```

---

## Using The Cache Correctly

The payer list endpoint is designed to be polled cheaply.

Every response includes an `ETag`.

If your app already has the last payer snapshot, call the endpoint like this:

```bash
curl http://localhost:3000/v1/watches/<watch-id>/payers \
  -H 'If-None-Match: "<previous-etag>"'
```

If nothing changed:

- the service returns `304 Not Modified`
- no new JSON payload is sent

That gives you two wins:

- less bandwidth
- a very simple sync strategy for your app

### Example application-side polling logic

```ts
let etag: string | null = null;
let cachedPayers: unknown[] = [];

export async function syncPayers(watchId: string) {
  const response = await fetch(`http://localhost:3000/v1/watches/${watchId}/payers`, {
    headers: etag ? { "If-None-Match": etag } : {},
  });

  if (response.status === 304) {
    return cachedPayers;
  }

  etag = response.headers.get("etag");
  const payload = await response.json();
  cachedPayers = payload.items;
  return cachedPayers;
}
```

---

## How To Integrate This Into Another Project

The usual integration pattern is:

1. your main app creates or updates a watch
2. your main app stores the returned `watch.id`
3. your main app periodically fetches `/payers`
4. your app decides whether a payer is recognized and what access to grant

### Example: create a watch from your backend

```ts
const response = await fetch("http://stablecoin-payments:3000/v1/watches", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    address: "0xYourWallet",
    label: "Treasury",
    chains: ["ethereum", "base"],
    includeDefaultTokens: true,
  }),
});

const watch = await response.json();
console.log(watch.id);
```

### Example: answer "has this address paid?"

```ts
type PayerSummary = {
  payerAddress: string;
  totalAmount: string;
};

async function hasPaid(serviceUrl: string, watchId: string, wallet: string) {
  const response = await fetch(`${serviceUrl}/v1/watches/${watchId}/payers`);
  const payload = await response.json();

  return payload.items.some(
    (payer: PayerSummary) => payer.payerAddress.toLowerCase() === wallet.toLowerCase(),
  );
}
```

### Example: answer "how much has this address paid?"

```ts
async function amountPaid(serviceUrl: string, watchId: string, wallet: string) {
  const response = await fetch(`${serviceUrl}/v1/watches/${watchId}/payers`);
  const payload = await response.json();

  const payer = payload.items.find(
    (item: { payerAddress: string; totalAmount: string }) =>
      item.payerAddress.toLowerCase() === wallet.toLowerCase(),
  );

  return payer ? payer.totalAmount : "0";
}
```

### Integration recommendation

Do the final authorization check in your own backend, not in the browser.

Treat this service as:

- a source of truth for finalized payer data
- not your only app-layer access control boundary

---

## API Reference

### `GET /v1/health`

Basic health check.

### `GET /v1/registry`

Returns enabled chains, defaults, and which RPC URLs are explicitly configured.

### `GET /v1/watches`

Lists all watches.

### `POST /v1/watches`

Creates or updates a watch.

### `GET /v1/watches/:watchId`

Returns a single watch and its targets.

### `GET /v1/watches/by-address/:address`

Looks up a watch by the recipient wallet address.

### `GET /v1/watches/:watchId/payers`

Returns the aggregated payer list.

### `GET /v1/watches/:watchId/payments`

Returns finalized raw payment events.

### `DELETE /v1/watches/:watchId`

Deactivates the watch and its targets.

---

## Storage Model

SQLite keeps four tables:

- `watches`
- `watch_targets`
- `payments`
- `payer_summaries`

Why both `payments` and `payer_summaries`?

- `payments` gives you the auditable event history
- `payer_summaries` gives you a cheap app-friendly read model

---

## How Finality Works Here

This service uses confirmation buffers.

That means:

- a payment is seen on-chain first
- the service waits for a configured number of additional blocks
- only then is the payment written into the persistent ledger

This is a pragmatic production choice for a lightweight service.

It is not a full consensus-finality proof system.

Default confirmation buffers are currently:

- Ethereum: 15
- Arbitrum: 20
- Optimism: 20
- Base: 20

---

## Operational Notes

- This repo is designed for one active poller per database.
- Running multiple service instances against the same SQLite file is not supported.
- For production, use dedicated RPC URLs.
- SQLite is the right default for single-instance deployment.
- If you want horizontal scale, split the worker role or swap the storage layer.

---

## Recommended Deployment Shapes

### Smallest useful production setup

- one container
- one persistent volume
- one dedicated RPC URL per enabled chain

### Good fits

- Fly.io machine
- Render web service with persistent disk
- Railway container with mounted storage
- small VM with Docker

### Less ideal

- stateless multi-replica deployment sharing a local SQLite file

---

## Development

### Install and verify

```bash
pnpm install
pnpm check
```

### Run locally

```bash
pnpm dev
```

### Build for production

```bash
pnpm build
pnpm start
```

---

## Repo Layout

```text
src/app.ts                     Fastify app and routes
src/services/monitor-service.ts  Background chain polling
src/services/watch-service.ts    Watch creation and target assembly
src/db/store.ts                  SQLite persistence layer
public/                          Built-in admin UI
test/                            Focused API tests
```

---

## Current Limitations

- confirmation-based finality only
- SQLite only
- one active polling instance per database
- no outbound webhooks yet
- no explicit per-chain confirmation overrides in the public API yet

---

## Roadmap Ideas

- Postgres backend
- separate API and worker roles
- webhooks for new payments or first-time payers
- CSV export
- signed snapshots
- per-chain confirmation overrides

---

## Summary

If you want a service that can answer:

- "who has paid this wallet?"
- "how much did this address pay?"
- "give me a stable cached payer list I can sync into my app"

without building your own chain indexer, this repo is the intended starting point.

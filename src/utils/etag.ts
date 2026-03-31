import type { PayerQuery } from "../types.js";

export function buildFilterKey(query: PayerQuery): string {
  return `${query.chainKey ?? "all"}:${query.tokenKey ?? "all"}`;
}

export function buildPayerListEtag(version: number, filterKey: string): string {
  return `"payers:${version}:${filterKey}"`;
}

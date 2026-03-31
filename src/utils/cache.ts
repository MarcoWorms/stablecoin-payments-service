export interface CacheEntry<T> {
  etag: string;
  expiresAt: number;
  value: T;
}

export class ResponseCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
  ) {}

  get(key: string, etag: string): T | null {
    const entry = this.entries.get(key);

    if (!entry) {
      return null;
    }

    if (entry.expiresAt <= Date.now() || entry.etag !== etag) {
      this.entries.delete(key);
      return null;
    }

    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, etag: string, value: T): void {
    if (this.entries.has(key)) {
      this.entries.delete(key);
    }

    if (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey) {
        this.entries.delete(oldestKey);
      }
    }

    this.entries.set(key, {
      etag,
      expiresAt: Date.now() + this.ttlMs,
      value,
    });
  }

  clear(): void {
    this.entries.clear();
  }
}

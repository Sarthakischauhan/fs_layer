/**
 * ContentCache: in-memory per-session cache for reassembled page content.
 * Prevents redundant backend fetches during grep + cat workflows.
 */
export class ContentCache {
  private readonly store = new Map<string, string>();

  get(slug: string): string | undefined {
    return this.store.get(slug);
  }

  put(slug: string, content: string): void {
    this.store.set(slug, content);
  }

  has(slug: string): boolean {
    return this.store.has(slug);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

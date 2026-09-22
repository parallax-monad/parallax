/** Small in-memory key/value foundation shared by backend adapter registries. */
export class AdapterRegistry<Key, Value> {
  private readonly values = new Map<Key, Value>();

  public get size(): number {
    return this.values.size;
  }

  public has(key: Key): boolean {
    return this.values.has(key);
  }

  public get(key: Key): Value | undefined {
    return this.values.get(key);
  }

  public set(key: Key, value: Value): void {
    this.values.set(key, value);
  }

  public entries(): IterableIterator<[Key, Value]> {
    return this.values.entries();
  }
}

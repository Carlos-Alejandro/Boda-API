import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { vi } from "vitest";

type Data = Record<string, unknown>;
type Ref = { id: string; path: string; get: () => Promise<unknown>; create: (data: Data) => Promise<void> };
type Transaction = { get: (ref: Ref) => Promise<unknown>; create: (ref: Ref, data: Data) => void };

// A deterministic optimistic transaction fake: staged creates are applied only
// if all read versions still match. No Firestore connection or sleeps.
export class CreationFirestore {
  readonly documents = new Map<string, { data: Data; version: number }>();
  readonly committedCreates: string[] = [];
  readonly stagedAttempts: Array<Array<{ path: string; data: Data }>> = [];
  beforeCommit?: (attempt: number, writes: Array<{ path: string; data: Data }>) => Promise<void> | void;
  afterCommit?: () => void;
  onRead?: (path: string, transactional: boolean) => void;
  private revision = 0;

  put(path: string, data: Data) {
    this.documents.set(path, { data, version: ++this.revision });
  }
  private snapshot(path: string, transactional: boolean) {
    this.onRead?.(path, transactional);
    const stored = this.documents.get(path);
    return {
      exists: !!stored, id: path.split("/").at(-1)!, ref: this.ref(path),
      updateTime: stored ? new Timestamp(stored.version, 0) : undefined,
      data: () => stored?.data,
    };
  }
  private persist(path: string, data: Data) {
    const timestamp = new Timestamp(this.revision + 1, 0);
    const resolved = Object.fromEntries(Object.entries(data).map(([key, value]) => [
      key, value instanceof FieldValue && value.isEqual(FieldValue.serverTimestamp()) ? timestamp : value,
    ]));
    this.put(path, resolved);
    this.committedCreates.push(path);
  }
  private ref(path: string): Ref {
    return {
      id: path.split("/").at(-1)!, path,
      get: async () => this.snapshot(path, false),
      create: async data => {
        if (this.documents.has(path)) throw Object.assign(new Error("exists"), { code: 6 });
        this.persist(path, data);
      },
    };
  }
  collection = (name: string) => ({ doc: (id: string) => this.ref(name + "/" + id) });

  runTransaction = vi.fn(async (callback: (transaction: Transaction) => Promise<unknown>) => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const reads = new Map<string, number | undefined>();
      const writes: Array<{ path: string; data: Data }> = [];
      this.stagedAttempts.push(writes);
      const result = await callback({
        get: async ref => {
          if (writes.length) throw new Error("Read after write");
          const snapshot = this.snapshot(ref.path, true);
          reads.set(ref.path, this.documents.get(ref.path)?.version);
          return snapshot;
        },
        create: (ref, data) => { writes.push({ path: ref.path, data }); },
      });
      await this.beforeCommit?.(attempt, writes);
      if ([...reads].some(([path, version]) => this.documents.get(path)?.version !== version)) continue;
      if (writes.some(write => this.documents.has(write.path))) {
        throw Object.assign(new Error("exists"), { code: 6 });
      }
      for (const write of writes) this.persist(write.path, write.data);
      this.afterCommit?.();
      return result;
    }
    throw new Error("Fake transaction retry limit");
  });
}

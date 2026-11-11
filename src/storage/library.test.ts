import 'fake-indexeddb/auto';
import { clear, createStore, entries, set as rawSet } from 'idb-keyval';
import { describe, expect, it, vi } from 'vitest';
import { createProfile } from '../core/geometry/profile';
import { brushAction } from '../core/painting/actions';
import type { PaintingAction, StudioArtworkV2 } from '../types/artwork';
import {
  STUDIO_DB_NAME,
  STUDIO_STORE_NAME,
  StorageError,
  deleteArtwork,
  describeBytes,
  getArtwork,
  listGallery,
  migrateArtwork,
  saveArtwork,
  validateArtwork,
} from './library';

/** 与 library.ts 指向同一个对象仓库，用来写入原始（未校验的）记录。 */
const rawStore = createStore(STUDIO_DB_NAME, STUDIO_STORE_NAME);

function makeActions(): PaintingAction[] {
  return [
    brushAction(
      [
        { u: 0.1, v: 0.2 },
        { u: 0.3, v: 0.4 },
      ],
      { size: 24, color: '#174a94' },
    ),
    brushAction([{ u: 0.6, v: 0.7 }], { size: 48, color: '#9ab6d5' }),
  ];
}

function makeV2(overrides: Partial<StudioArtworkV2> = {}): StudioArtworkV2 {
  return {
    version: 2,
    id: 'art-1',
    name: '青花瓶',
    createdAt: 1000,
    updatedAt: 1000,
    profile: createProfile(),
    actions: makeActions(),
    image: new Blob(['png-bytes'], { type: 'image/png' }),
    ...overrides,
  };
}

function makeV1() {
  return {
    version: 1 as const,
    id: 'legacy-1',
    name: '旧版作品',
    createdAt: 500,
    profile: createProfile(),
    strokes: [
      {
        points: [
          { u: 0.2, v: 0.3 },
          { u: 0.4, v: 0.5 },
        ],
        size: 24,
        color: '#174a94',
      },
      {
        points: [{ u: 0.7, v: 0.8 }],
        size: 12,
        color: '#547fb2',
      },
    ],
    image: new Blob(['legacy-png'], { type: 'image/png' }),
  };
}

/** 直接往同一对象仓库里塞原始数据，用来模拟旧版本或损坏的记录。 */
async function putRaw(id: string, value: unknown): Promise<void> {
  await rawSet(id, value, rawStore);
}

async function rawEntries(): Promise<[IDBValidKey, unknown][]> {
  return entries<IDBValidKey, unknown>(rawStore);
}

/** 清空对象仓库，但保留数据库与仓库本身（库模块会缓存数据库连接）。 */
async function resetStore(): Promise<void> {
  await clear(rawStore);
}

/** 让底层写入抛出指定错误，模拟浏览器在配额不足时的行为。 */
async function withFailingPut(
  error: DOMException,
  run: () => Promise<void>,
): Promise<void> {
  const original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function failingPut() {
    throw error;
  };
  try {
    await run();
  } finally {
    IDBObjectStore.prototype.put = original;
  }
}

/** 只会成功返回结果的最小 IDBRequest 替身。 */
class FakeRequest<T> {
  result: T;
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  #onsuccess: (() => void) | null = null;

  constructor(value: T) {
    this.result = value;
  }

  get onsuccess(): (() => void) | null {
    return this.#onsuccess;
  }

  set onsuccess(handler: (() => void) | null) {
    this.#onsuccess = handler;
    if (handler) queueMicrotask(() => handler());
  }
}

/** 只够 library.ts 打开连接用的最小 IDBDatabase 替身。 */
class FakeDatabase {
  closed = false;
  onversionchange: ((event: Event) => void) | null = null;
  readonly objectStoreNames = {
    contains: () => true,
  };
  createObjectStore(): void {
    /* 升级时创建仓库，测试里只关心它被调用过。 */
  }
  transaction(): { objectStore: () => IDBObjectStore } {
    const store = {
      getAll: () => new FakeRequest<unknown[]>([]),
      getAllKeys: () => new FakeRequest<IDBValidKey[]>([]),
    };
    return { objectStore: () => store as unknown as IDBObjectStore };
  }
  close(): void {
    this.closed = true;
  }
}

describe('storage library', () => {
  it('writes and reads back a v2 record', async () => {
    await resetStore();
    const artwork = makeV2();
    await saveArtwork(artwork);

    const loaded = await getArtwork('art-1');
    expect(loaded).toBeDefined();
    expect(loaded?.version).toBe(2);
    expect(loaded?.id).toBe('art-1');
    expect(loaded?.name).toBe('青花瓶');
    expect(loaded?.profile).toEqual(createProfile());
    expect(loaded?.actions).toEqual(makeActions());
    expect(loaded?.image.size).toBe(artwork.image.size);
    expect(await loaded!.image.text()).toBe('png-bytes');

    const listing = await listGallery();
    expect(listing.artworks.map((a) => a.id)).toEqual(['art-1']);
    expect(listing.damaged).toEqual([]);
  });

  it('migrates a v1 record keeping profile, strokes and image', async () => {
    await resetStore();
    const legacy = makeV1();
    await putRaw(legacy.id, legacy);

    const loaded = await getArtwork(legacy.id);
    expect(loaded?.version).toBe(2);
    expect(loaded?.profile).toEqual(legacy.profile);
    expect(loaded?.actions).toHaveLength(legacy.strokes.length);
    expect(loaded?.actions[0]).toEqual({
      type: 'BRUSH',
      path: legacy.strokes[0].points,
      color: legacy.strokes[0].color,
      opacity: 1,
      size: legacy.strokes[0].size,
    });
    const second = loaded?.actions[1];
    expect(second?.type).toBe('BRUSH');
    expect(second?.type === 'BRUSH' && second.size).toBe(
      legacy.strokes[1].size,
    );
    expect(loaded?.updatedAt).toBe(legacy.createdAt);
    expect(loaded?.createdAt).toBe(legacy.createdAt);
    expect(loaded?.image.size).toBe(legacy.image.size);

    // 读时迁移不会破坏原始记录，应用下次保存时再写回 v2。
    const raw = await rawEntries();
    expect((raw[0][1] as { version: number }).version).toBe(1);

    await saveArtwork(loaded!);
    const reread = await getArtwork(legacy.id);
    expect(reread?.version).toBe(2);
    expect(reread?.actions).toHaveLength(legacy.strokes.length);
    expect(reread?.profile).toEqual(legacy.profile);
  });

  it('rejects an unknown version with a dedicated error code', () => {
    expect(() => migrateArtwork({ version: 99, id: 'x' })).toThrow(
      StorageError,
    );
    try {
      migrateArtwork({ version: 99, id: 'x' });
      expect.unreachable('应当抛出未知版本错误');
    } catch (error) {
      expect(error).toBeInstanceOf(StorageError);
      expect((error as StorageError).code).toBe('unknown-version');
      expect((error as StorageError).userMessage).toContain('更新版本');
    }
  });

  it('rejects malformed data as corrupt', () => {
    expect(() => validateArtwork(null)).toThrow(StorageError);
    expect(() => validateArtwork({ ...makeV2(), id: '' })).toThrow(
      StorageError,
    );
    expect(() =>
      validateArtwork({ ...makeV2(), profile: 'not-a-profile' }),
    ).toThrow(StorageError);
    expect(() =>
      validateArtwork({ ...makeV2(), actions: [{ type: 'NOPE' }] }),
    ).toThrow(StorageError);
    try {
      validateArtwork({ ...makeV2(), image: 'not-a-blob' });
      expect.unreachable('应当抛出损坏错误');
    } catch (error) {
      expect((error as StorageError).code).toBe('corrupt');
    }
  });

  it('round-trips a custom vessel height scale', () => {
    const validated = validateArtwork({ ...makeV2(), heightScale: 0.72 });
    expect(validated.heightScale).toBe(0.72);
  });

  it('rejects broken legacy v1 records', () => {
    const cases: unknown[] = [
      { ...makeV1(), strokes: 'nope' },
      { ...makeV1(), strokes: ['nope'] },
      {
        ...makeV1(),
        strokes: [{ points: [{ u: 0.1, v: 0.2 }], size: 0, color: '#fff' }],
      },
      {
        ...makeV1(),
        strokes: [{ points: [{ u: 0.1, v: 0.2 }], size: 24, color: 1 }],
      },
      { ...makeV1(), strokes: [{ points: 'nope', size: 24, color: '#fff' }] },
      { ...makeV1(), profile: 'nope' },
      { ...makeV1(), image: 'nope' },
      { ...makeV1(), id: '' },
      { ...makeV1(), name: 42 },
      { ...makeV1(), createdAt: 'nope' },
    ];
    for (const record of cases) {
      expect(() => migrateArtwork(record)).toThrow(StorageError);
    }
  });

  it('rejects a v1 record given to the v2 validator', () => {
    expect(() => validateArtwork(makeV1())).toThrow(StorageError);
    try {
      validateArtwork(makeV1());
      expect.unreachable('应当抛出损坏错误');
    } catch (error) {
      expect((error as StorageError).code).toBe('corrupt');
    }
  });

  it('rejects an unknown version given to the v2 validator', () => {
    expect(() => validateArtwork({ ...makeV2(), version: 99 })).toThrow(
      StorageError,
    );
    try {
      validateArtwork({ ...makeV2(), version: 99 });
      expect.unreachable('应当抛出未知版本错误');
    } catch (error) {
      expect((error as StorageError).code).toBe('unknown-version');
    }
  });

  it('rejects non-array paths, actions and non-object commands', () => {
    expect(() =>
      validateArtwork({ ...makeV2(), actions: 'not-an-array' }),
    ).toThrow(StorageError);
    expect(() =>
      validateArtwork({
        ...makeV2(),
        actions: [
          {
            type: 'BRUSH',
            path: 'not-an-array',
            color: '#fff',
            opacity: 1,
            size: 1,
          },
        ],
      }),
    ).toThrow(StorageError);
    expect(() =>
      validateArtwork({
        ...makeV2(),
        actions: [
          {
            type: 'BRUSH',
            path: ['not-a-point'],
            color: '#fff',
            opacity: 1,
            size: 1,
          },
        ],
      }),
    ).toThrow(StorageError);
    expect(() =>
      validateArtwork({ ...makeV2(), actions: ['not-a-command'] }),
    ).toThrow(StorageError);
  });

  it('rejects an invalid createdAt', () => {
    expect(() => validateArtwork({ ...makeV2(), createdAt: 'nope' })).toThrow(
      StorageError,
    );
  });

  it('accepts a blob-like image that is not a Blob instance', () => {
    const blobLike = {
      size: 4,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
    };
    const validated = validateArtwork({ ...makeV2(), image: blobLike });
    expect(validated.image).toBe(blobLike);
  });

  it('orders equal creation times by the most recently updated first', async () => {
    await resetStore();
    await putRaw('a', makeV2({ id: 'a', createdAt: 500, updatedAt: 500 }));
    await putRaw('b', makeV2({ id: 'b', createdAt: 500, updatedAt: 900 }));

    const listing = await listGallery();
    expect(listing.artworks.map((a) => a.id)).toEqual(['b', 'a']);
  });

  it('keeps stamp and erase commands intact', async () => {
    await resetStore();
    const artwork = makeV2({
      actions: [
        {
          type: 'STAMP',
          u: 0.5,
          v: 0.5,
          assetId: 'lotus',
          color: '#174a94',
          scale: 1.5,
          rotation: Math.PI,
          footprint: { u: 0.27, v: 0.4 },
          repeatCount: 12,
        },
        { type: 'ERASE', path: [{ u: 0.2, v: 0.3 }], size: 30 },
      ],
    });
    await saveArtwork(artwork);

    const loaded = await getArtwork('art-1');
    expect(loaded?.actions).toEqual(artwork.actions);
  });

  it('rejects broken stamp and erase commands', () => {
    const stamp = {
      type: 'STAMP',
      u: 0.5,
      v: 0.5,
      assetId: 'museum-horse',
      color: '#174a94',
      scale: 1,
      rotation: 0,
    };
    const cases: unknown[] = [
      { ...stamp, footprint: null },
      { ...stamp, footprint: { u: 0, v: 0.4 } },
      { ...stamp, footprint: { u: 0.3, v: 1.01 } },
      { ...stamp, footprint: { u: 0.3, v: NaN } },
      { ...stamp, repeatCount: 1 },
      { ...stamp, repeatCount: 2.5 },
      { ...stamp, repeatCount: 257 },
      {
        type: 'STAMP',
        u: 'x',
        v: 0.5,
        assetId: 'a',
        color: '#fff',
        scale: 1,
        rotation: 0,
      },
      {
        type: 'STAMP',
        u: 0.5,
        v: 0.5,
        assetId: '',
        color: '#fff',
        scale: 1,
        rotation: 0,
      },
      {
        type: 'STAMP',
        u: 0.5,
        v: 0.5,
        assetId: 'a',
        color: 1,
        scale: 1,
        rotation: 0,
      },
      {
        type: 'STAMP',
        u: 0.5,
        v: 0.5,
        assetId: 'a',
        color: '#fff',
        scale: 0,
        rotation: 0,
      },
      {
        type: 'STAMP',
        u: 0.5,
        v: 0.5,
        assetId: 'a',
        color: '#fff',
        scale: 1,
        rotation: 'x',
      },
      { type: 'ERASE', path: 'nope', size: 30 },
      { type: 'ERASE', path: [{ u: 0.2, v: 0.3 }], size: 0 },
    ];
    for (const action of cases) {
      expect(() => validateArtwork({ ...makeV2(), actions: [action] })).toThrow(
        StorageError,
      );
    }
  });

  it('rejects broken brush commands and profiles', () => {
    const broken: unknown[] = [
      {
        type: 'BRUSH',
        path: [{ u: 'x', v: 0.2 }],
        color: '#fff',
        opacity: 1,
        size: 24,
      },
      {
        type: 'BRUSH',
        path: [{ u: 0.1, v: 0.2 }],
        color: 1,
        opacity: 1,
        size: 24,
      },
      {
        type: 'BRUSH',
        path: [{ u: 0.1, v: 0.2 }],
        color: '#fff',
        opacity: 5,
        size: 24,
      },
      {
        type: 'BRUSH',
        path: [{ u: 0.1, v: 0.2 }],
        color: '#fff',
        opacity: 1,
        size: 0,
      },
      { type: 'BRUSH', path: 'nope', color: '#fff', opacity: 1, size: 24 },
    ];
    for (const action of broken) {
      expect(() => validateArtwork({ ...makeV2(), actions: [action] })).toThrow(
        StorageError,
      );
    }
    const profiles: unknown[] = [
      [],
      [{ id: 'p', height: 'x', radius: 0.3 }],
      [{ id: 'p', height: 0.5, radius: -1 }],
      [{ id: '', height: 0.5, radius: 0.3 }],
      [{ id: 'p', height: 2, radius: 0.3 }],
      ['not-a-point'],
    ];
    for (const profile of profiles) {
      expect(() => validateArtwork({ ...makeV2(), profile })).toThrow(
        StorageError,
      );
    }
  });

  it('keeps optional texture, challenge and score fields', async () => {
    await resetStore();
    const artwork = makeV2({
      texture: new Blob(['tex'], { type: 'image/png' }),
      challengeId: 'yuhuchunping',
      score: 87.5,
    });
    await saveArtwork(artwork);

    const loaded = await getArtwork('art-1');
    expect(loaded?.texture?.size).toBe(artwork.texture?.size);
    expect(loaded?.challengeId).toBe('yuhuchunping');
    expect(loaded?.score).toBe(87.5);
    expect(() =>
      validateArtwork({ ...makeV2(), texture: 'not-a-blob' }),
    ).toThrow(StorageError);
    expect(() => validateArtwork({ ...makeV2(), challengeId: 42 })).toThrow(
      StorageError,
    );
    expect(() => validateArtwork({ ...makeV2(), score: 'x' })).toThrow(
      StorageError,
    );
  });

  it('normalises a missing updatedAt to createdAt', () => {
    const withoutUpdatedAt = { ...makeV2() } as Partial<StudioArtworkV2>;
    delete withoutUpdatedAt.updatedAt;
    const validated = validateArtwork(withoutUpdatedAt);
    expect(validated.updatedAt).toBe(validated.createdAt);
  });

  it('quarantines a damaged record but keeps listing the rest', async () => {
    await resetStore();
    await saveArtwork(makeV2({ id: 'good-1' }));
    await putRaw('broken-1', { version: 2, id: 'broken-1' });
    await putRaw('future-1', { version: 42, id: 'future-1' });
    await putRaw('junk-1', 'not-a-record');

    const listing = await listGallery();
    expect(listing.artworks.map((a) => a.id)).toEqual(['good-1']);
    expect(listing.damaged.map((d) => d.id).sort()).toEqual([
      'broken-1',
      'future-1',
      'junk-1',
    ]);
    expect(listing.damaged.find((d) => d.id === 'future-1')?.code).toBe(
      'unknown-version',
    );
    expect(listing.damaged.find((d) => d.id === 'broken-1')?.code).toBe(
      'corrupt',
    );
    for (const damaged of listing.damaged) {
      expect(damaged.reason.length).toBeGreaterThan(0);
    }
  });

  it('maps a quota failure to a retryable quota error', async () => {
    await resetStore();
    await saveArtwork(makeV2({ id: 'keep-1', name: '保留作品' }));
    const quotaError = new DOMException('quota', 'QuotaExceededError');

    await withFailingPut(quotaError, async () => {
      await expect(
        saveArtwork(makeV2({ id: 'keep-1', name: '被覆盖' })),
      ).rejects.toMatchObject({ code: 'quota' });
    });

    // 失败不能清空已有作品，重试仍然可用。
    const kept = await getArtwork('keep-1');
    expect(kept?.name).toBe('保留作品');
    await saveArtwork(makeV2({ id: 'keep-1', name: '重试成功' }));
    expect((await getArtwork('keep-1'))?.name).toBe('重试成功');
  });

  it('maps an encoding failure to an encoding error', async () => {
    await resetStore();
    const encodeError = new DOMException('clone', 'DataCloneError');
    await withFailingPut(encodeError, async () => {
      await expect(saveArtwork(makeV2())).rejects.toMatchObject({
        code: 'encoding',
      });
    });
  });

  it('maps a missing IndexedDB to an unavailable error', async () => {
    vi.resetModules();
    const original = globalThis.indexedDB;
    try {
      // @ts-expect-error 故意移除全局对象以模拟浏览器禁用存储
      delete globalThis.indexedDB;
      const isolated = await import('./library');
      await expect(isolated.listGallery()).rejects.toMatchObject({
        code: 'unavailable',
      });
    } finally {
      globalThis.indexedDB = original;
      vi.resetModules();
    }
  });

  it('creates the object store when the database is opened for the first time', async () => {
    vi.resetModules();
    const original = globalThis.indexedDB;
    let created = false;
    globalThis.indexedDB = {
      open: () => {
        const request: Record<string, unknown> = {};
        queueMicrotask(() => {
          const db = new FakeDatabase();
          db.objectStoreNames.contains = () => false;
          db.createObjectStore = () => {
            created = true;
          };
          request.result = db;
          (request.onupgradeneeded as (() => void) | null)?.();
          (request.onsuccess as (() => void) | null)?.();
        });
        return request;
      },
    } as unknown as IDBFactory;
    try {
      const isolated = await import('./library');
      await isolated.listGallery();
      expect(created).toBe(true);
    } finally {
      globalThis.indexedDB = original;
      vi.resetModules();
    }
  });

  it('maps a synchronous open failure to an unavailable error', async () => {
    vi.resetModules();
    const original = globalThis.indexedDB;
    globalThis.indexedDB = {
      open: () => {
        throw new DOMException('denied', 'SecurityError');
      },
    } as unknown as IDBFactory;
    try {
      const isolated = await import('./library');
      await expect(isolated.listGallery()).rejects.toMatchObject({
        code: 'unavailable',
      });
    } finally {
      globalThis.indexedDB = original;
      vi.resetModules();
    }
  });

  it('maps legacy DOMException codes to the right error code', async () => {
    vi.resetModules();
    const original = globalThis.indexedDB;
    const openWithError = (error: unknown) => {
      globalThis.indexedDB = {
        open: () => {
          const request: Record<string, unknown> = { error };
          queueMicrotask(() => {
            (request.onerror as (() => void) | null)?.();
          });
          return request;
        },
      } as unknown as IDBFactory;
    };

    try {
      openWithError({ name: 'QuotaExceededError', code: 22 });
      let isolated = await import('./library');
      await expect(isolated.listGallery()).rejects.toMatchObject({
        code: 'quota',
      });

      vi.resetModules();
      openWithError({ code: 18 });
      isolated = await import('./library');
      await expect(isolated.listGallery()).rejects.toMatchObject({
        code: 'unavailable',
      });

      vi.resetModules();
      openWithError({ name: 'UnknownError' });
      isolated = await import('./library');
      await expect(isolated.listGallery()).rejects.toMatchObject({
        code: 'unknown',
      });

      // 旧版 DOMException 只有数字错误码。
      vi.resetModules();
      openWithError({ code: 22 });
      isolated = await import('./library');
      await expect(isolated.listGallery()).rejects.toMatchObject({
        code: 'quota',
      });

      vi.resetModules();
      openWithError({ code: 18 });
      isolated = await import('./library');
      await expect(isolated.listGallery()).rejects.toMatchObject({
        code: 'unavailable',
      });

      // 完全无法识别的错误归到 unknown。
      vi.resetModules();
      openWithError({ name: 'SomethingElse' });
      isolated = await import('./library');
      await expect(isolated.listGallery()).rejects.toMatchObject({
        code: 'unknown',
      });
    } finally {
      globalThis.indexedDB = original;
      vi.resetModules();
    }
  });

  it('maps a blocked database open to an unavailable error', async () => {
    vi.resetModules();
    const original = globalThis.indexedDB;
    globalThis.indexedDB = {
      open: () => {
        const request: Record<string, unknown> = {};
        queueMicrotask(() => {
          (request.onblocked as (() => void) | null)?.();
        });
        return request;
      },
    } as unknown as IDBFactory;
    try {
      const isolated = await import('./library');
      await expect(isolated.listGallery()).rejects.toMatchObject({
        code: 'unavailable',
      });
    } finally {
      globalThis.indexedDB = original;
      vi.resetModules();
    }
  });

  it('maps a failed database open to an unavailable error', async () => {
    vi.resetModules();
    const original = globalThis.indexedDB;
    globalThis.indexedDB = {
      open: () => {
        const request: Record<string, unknown> = {
          error: new DOMException('denied', 'SecurityError'),
        };
        queueMicrotask(() => {
          (request.onerror as (() => void) | null)?.();
        });
        return request;
      },
    } as unknown as IDBFactory;
    try {
      const isolated = await import('./library');
      await expect(isolated.listGallery()).rejects.toMatchObject({
        code: 'unavailable',
      });
    } finally {
      globalThis.indexedDB = original;
      vi.resetModules();
    }
  });

  it('maps a failed read to an unavailable error', async () => {
    await resetStore();
    const originalGet = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function failingGet() {
      throw new DOMException('denied', 'InvalidStateError');
    };
    try {
      await expect(getArtwork('art-1')).rejects.toMatchObject({
        code: 'unavailable',
      });
    } finally {
      IDBObjectStore.prototype.get = originalGet;
    }
  });

  it('maps a failed delete to an unavailable error', async () => {
    await resetStore();
    const originalDelete = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function failingDelete() {
      throw new DOMException('denied', 'InvalidStateError');
    };
    try {
      await expect(deleteArtwork('art-1')).rejects.toMatchObject({
        code: 'unavailable',
      });
    } finally {
      IDBObjectStore.prototype.delete = originalDelete;
    }
  });

  it('reopens the database after another connection upgrades it', async () => {
    vi.resetModules();
    const original = globalThis.indexedDB;
    let opened = 0;
    const connections: FakeDatabase[] = [];
    globalThis.indexedDB = {
      open: () => {
        opened += 1;
        const request: Record<string, unknown> = {};
        queueMicrotask(() => {
          const db = new FakeDatabase();
          connections.push(db);
          request.result = db;
          (request.onsuccess as (() => void) | null)?.();
        });
        return request;
      },
    } as unknown as IDBFactory;
    try {
      const isolated = await import('./library');
      await isolated.listGallery();
      expect(opened).toBe(1);

      // 其它标签页升级数据库版本，本模块要主动让路并重新打开。
      connections[0].onversionchange?.(new Event('versionchange'));
      expect(connections[0].closed).toBe(true);

      await isolated.listGallery();
      expect(opened).toBe(2);
    } finally {
      globalThis.indexedDB = original;
      vi.resetModules();
    }
  });

  it('keeps createdAt and advances updatedAt when saving the same id twice', async () => {
    await resetStore();
    await saveArtwork(makeV2({ createdAt: 1000, updatedAt: 1000 }));
    const first = await getArtwork('art-1');

    await saveArtwork(makeV2({ createdAt: 9999, updatedAt: 9999 }));
    const second = await getArtwork('art-1');

    expect(second?.createdAt).toBe(1000);
    expect(first).toBeDefined();
    expect(second!.updatedAt).toBeGreaterThan(first!.updatedAt);
    expect(second!.updatedAt).toBeGreaterThanOrEqual(9999);
  });

  it('does not mix up artworks when two saves of the same id overlap', async () => {
    await resetStore();
    await Promise.all([
      saveArtwork(makeV2({ name: '第一版' })),
      saveArtwork(makeV2({ name: '第二版' })),
    ]);
    const stored = await getArtwork('art-1');
    expect(['第一版', '第二版']).toContain(stored?.name);
    expect(stored?.createdAt).toBe(1000);
  });

  it('lists newest first and deletes on request', async () => {
    await resetStore();
    await saveArtwork(makeV2({ id: 'old', createdAt: 100, updatedAt: 100 }));
    await saveArtwork(makeV2({ id: 'new', createdAt: 900, updatedAt: 900 }));

    const listing = await listGallery();
    expect(listing.artworks.map((a) => a.id)).toEqual(['new', 'old']);

    await deleteArtwork('old');
    expect(await getArtwork('old')).toBeUndefined();
    expect((await listGallery()).artworks.map((a) => a.id)).toEqual(['new']);
    await expect(deleteArtwork('missing')).resolves.toBeUndefined();
  });

  it('describes byte sizes', () => {
    expect(describeBytes(0)).toBe('0 B');
    expect(describeBytes(512)).toBe('512 B');
    expect(describeBytes(1024)).toBe('1 KB');
    expect(describeBytes(1536)).toBe('1.5 KB');
    expect(describeBytes(1048576)).toContain('MB');
    expect(describeBytes(1048576 * 12)).toBe('12 MB');
  });
});

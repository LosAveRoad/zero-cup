import { expect, test, type Page } from '@playwright/test';
import type { PaintingAction } from '../../src/types/artwork';

const DATABASE_NAME = 'porcelain-tales-studio';
const OBJECT_STORE_NAME = 'artworks';
/** 一个真实的 1×1 PNG，用来给测试记录填上合法的 `image` 字段。 */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

interface ProfilePoint {
  id: string;
  height: number;
  radius: number;
}

/** 一条要直接写进 IndexedDB 的记录：纯数据 + 是否附带一张真实 PNG。 */
interface SeedRecord {
  id: string;
  record: Record<string, unknown>;
  attachPng?: boolean;
}

interface StoredRecordSummary {
  key: string;
  version: unknown;
  name: unknown;
  createdAt: unknown;
  updatedAt: unknown;
  profile: unknown;
  strokes: unknown;
  actions: unknown;
  imageSize: number;
  textureHash: string | null;
}

/** 与 `src/core/geometry/profile.ts` 的默认器型一致（8 个截面点）。 */
const DEFAULT_PROFILE: ProfilePoint[] = [
  0.35, 0.48, 0.57, 0.6, 0.53, 0.36, 0.25, 0.3,
].map((radius, index) => ({
  id: `point-${index}`,
  height: index / 7,
  radius,
}));

/**
 * 每个测试都从空的 IndexedDB 开始：先加载页面让应用建库，再删库并刷新。
 * 应用在 `versionchange` 时会自己关闭连接，删除不会被长期阻塞。
 */
async function resetDatabase(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(
    ({ databaseName }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(databaseName);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () =>
          reject(new Error('IndexedDB 删除被其它连接阻塞'));
      }),
    { databaseName: DATABASE_NAME },
  );
  await page.reload();
}

/** 绕过应用，直接把记录写进 `porcelain-tales-studio/artworks`。 */
async function seedRecords(page: Page, seeds: SeedRecord[]): Promise<void> {
  await page.evaluate(
    async ({ databaseName, storeName, pngBase64, records }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(databaseName);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(storeName)) {
            database.createObjectStore(storeName);
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      for (const seed of records) {
        const record: Record<string, unknown> = { ...seed.record };
        if (seed.attachPng) {
          const binary = atob(pngBase64);
          const bytes = new Uint8Array(binary.length);
          for (let index = 0; index < binary.length; index++) {
            bytes[index] = binary.charCodeAt(index);
          }
          record.image = new Blob([bytes], { type: 'image/png' });
        }
        store.put(record, seed.id);
      }
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      db.close();
    },
    {
      databaseName: DATABASE_NAME,
      storeName: OBJECT_STORE_NAME,
      pngBase64: PNG_BASE64,
      records: seeds,
    },
  );
}

/** 读取库里实际存了什么（Blob 只取体积，方便跨进程传回测试端）。 */
async function readRecords(page: Page): Promise<StoredRecordSummary[]> {
  return page.evaluate(
    async ({ databaseName, storeName }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(databaseName);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(storeName)) {
            database.createObjectStore(storeName);
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const store = db
        .transaction(storeName, 'readonly')
        .objectStore(storeName);
      const [keys, values] = await Promise.all([
        new Promise<IDBValidKey[]>((resolve, reject) => {
          const request = store.getAllKeys();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        }),
        new Promise<unknown[]>((resolve, reject) => {
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        }),
      ]);
      db.close();
      return Promise.all(
        values.map(async (value, index) => {
          const record = (value ?? {}) as Record<string, unknown>;
          const image = record.image;
          const texture = record.texture;
          const textureHash =
            texture instanceof Blob
              ? Array.from(
                  new Uint8Array(
                    await crypto.subtle.digest(
                      'SHA-256',
                      await texture.arrayBuffer(),
                    ),
                  ),
                  (byte) => byte.toString(16).padStart(2, '0'),
                ).join('')
              : null;
          return {
            key: String(keys[index]),
            version: record.version ?? null,
            name: record.name ?? null,
            createdAt: record.createdAt ?? null,
            updatedAt: record.updatedAt ?? null,
            profile: record.profile ?? null,
            strokes: record.strokes ?? null,
            actions: record.actions ?? null,
            imageSize: image instanceof Blob ? image.size : -1,
            textureHash,
          };
        }),
      );
    },
    { databaseName: DATABASE_NAME, storeName: OBJECT_STORE_NAME },
  );
}

/** 在器物表面画一笔，落笔点固定在已知会命中器物的位置。 */
async function drawStroke(page: Page, direction: 1 | -1): Promise<void> {
  const canvas = page.getByLabel('三维陶器画布');
  const rect = (await canvas.boundingBox())!;
  const startX = rect.x + rect.width / 2;
  const startY = rect.y + rect.height * 0.52;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 20 * direction, rect.y + rect.height * 0.48, {
    steps: 8,
  });
  await page.mouse.up();
}

/** 走一遍最短创作闭环，直到“保存到藏品”按钮可用。 */
async function createArtwork(
  page: Page,
  name: string,
  strokes = 0,
): Promise<void> {
  await page.getByRole('button', { name: '定型进入彩绘' }).click();
  for (let index = 0; index < strokes; index++) {
    await drawStroke(page, index % 2 === 0 ? 1 : -1);
    await expect(
      page.getByText(`已落笔 ${index + 1} 次`, { exact: false }),
    ).toBeVisible();
  }
  await page.getByRole('button', { name: '入窑烧制' }).click();
  await expect(page.getByRole('button', { name: '保存到藏品' })).toBeVisible();
  await page.getByLabel('作品名称').fill(name);
}

test.describe('旧版 v1 存档的读取迁移', () => {
  test('v1 记录可以打开：作品名、器型和每一条笔划都完整恢复', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await resetDatabase(page);
    await seedRecords(page, [
      {
        id: 'legacy-1',
        attachPng: true,
        record: {
          version: 1,
          id: 'legacy-1',
          name: '旧版青花碗',
          createdAt: 1000,
          profile: DEFAULT_PROFILE,
          strokes: [
            {
              points: [
                { u: 0.2, v: 0.3 },
                { u: 0.5, v: 0.55 },
              ],
              size: 24,
              color: '#174a94',
            },
            {
              points: [{ u: 0.6, v: 0.7 }],
              size: 12,
              color: '#547fb2',
            },
          ],
        },
      },
    ]);
    await page.reload();

    // 画廊里能看到这件旧作品，成品图也读得出来。
    await expect(
      page.getByRole('heading', { name: '旧版青花碗' }),
    ).toBeVisible();
    await expect(page.locator('.artwork')).toHaveCount(1);
    await expect(page.locator('.artwork img')).toHaveJSProperty(
      'naturalWidth',
      1,
    );

    // 迁移发生在读取时，库里的原始 v1 记录没有被改写。
    const beforeOpen = await readRecords(page);
    expect(beforeOpen).toHaveLength(1);
    expect(beforeOpen[0].version).toBe(1);
    expect(beforeOpen[0].strokes).toHaveLength(2);

    page.on('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: '打开作品' }).click();
    await expect(page.getByLabel('作品名称')).toHaveValue('旧版青花碗');
    await page.getByRole('button', { name: '继续彩绘' }).click();
    await expect(page.getByText('已落笔 2 次', { exact: false })).toBeVisible();

    // 再保存一次：器型、笔划和成品图都要按 v2 完整写回同一条记录。
    await page.getByRole('button', { name: '入窑烧制' }).click();
    await expect(
      page.getByRole('button', { name: '保存到藏品' }),
    ).toBeVisible();
    await page.getByRole('button', { name: '保存到藏品' }).click();
    await expect(page.getByRole('status')).toContainText('作品已保存');

    const afterSave = await readRecords(page);
    expect(afterSave).toHaveLength(1);
    expect(afterSave[0].version).toBe(2);
    expect(afterSave[0].name).toBe('旧版青花碗');
    expect(afterSave[0].profile).toEqual(DEFAULT_PROFILE);
    expect(afterSave[0].actions).toEqual([
      {
        type: 'BRUSH',
        path: [
          { u: 0.2, v: 0.3 },
          { u: 0.5, v: 0.55 },
        ],
        color: '#174a94',
        opacity: 1,
        size: 24,
      },
      {
        type: 'BRUSH',
        path: [{ u: 0.6, v: 0.7 }],
        color: '#547fb2',
        opacity: 1,
        size: 12,
      },
    ]);
    expect(afterSave[0].imageSize).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
});

test.describe('坏记录与未知版本的隔离', () => {
  test('损坏的记录不会拖垮画廊，好作品照常列出并提示隔离', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await resetDatabase(page);
    await seedRecords(page, [
      {
        id: 'good-1',
        attachPng: true,
        record: {
          version: 2,
          id: 'good-1',
          name: '完好的作品',
          createdAt: 2000,
          updatedAt: 2000,
          profile: DEFAULT_PROFILE,
          actions: [
            {
              type: 'BRUSH',
              path: [{ u: 0.3, v: 0.4 }],
              color: '#174a94',
              opacity: 1,
              size: 24,
            },
          ],
        },
      },
      {
        // 少了 profile / actions / image，是一条坏记录。
        id: 'broken',
        record: { version: 2, id: 'broken', name: '坏作品' },
      },
    ]);
    await page.reload();

    await expect(
      page.getByRole('heading', { name: '完好的作品' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: '坏作品' })).toHaveCount(0);
    await expect(page.locator('.artwork')).toHaveCount(1);
    await expect(
      page.getByText('有 1 件旧作品无法读取', { exact: false }),
    ).toBeVisible();

    // 隔离只是藏起来，坏记录本身仍然留在库里，没有被悄悄删掉。
    const stored = await readRecords(page);
    expect(stored.map((row) => row.key).sort()).toEqual(['broken', 'good-1']);
    expect(errors).toEqual([]);
  });

  test('未知版本的记录被隔离，不出现在画廊里', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await resetDatabase(page);
    await seedRecords(page, [
      {
        // 除了版本号，其它字段都合法：只有版本无法识别。
        id: 'future',
        attachPng: true,
        record: {
          version: 99,
          id: 'future',
          name: '未来作品',
          createdAt: 3000,
          updatedAt: 3000,
          profile: DEFAULT_PROFILE,
          actions: [],
        },
      },
    ]);
    await page.reload();

    await expect(page.getByRole('heading', { name: '未来作品' })).toHaveCount(
      0,
    );
    await expect(page.locator('.artwork')).toHaveCount(0);
    await expect(
      page.getByText('有 1 件旧作品无法读取', { exact: false }),
    ).toBeVisible();

    // 未知版本的记录同样只是被隔离，原始数据仍在库里。
    const stored = await readRecords(page);
    expect(stored).toHaveLength(1);
    expect(stored[0].key).toBe('future');
    expect(stored[0].version).toBe(99);
    expect(errors).toEqual([]);
  });
});

test.describe('藏瓷阁的保存与删除', () => {
  test('同一件作品保存两次只留下一个条目，标题是最新名字', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await resetDatabase(page);
    await createArtwork(page, '第一次保存');

    await page.getByRole('button', { name: '保存到藏品' }).click();
    await expect(
      page.getByRole('heading', { name: '第一次保存' }),
    ).toBeVisible();

    await page.getByLabel('作品名称').fill('第二次保存');
    await page.getByRole('button', { name: '保存到藏品' }).click();
    await expect(
      page.getByRole('heading', { name: '第二次保存' }),
    ).toBeVisible();

    await expect(page.locator('.artwork')).toHaveCount(1);
    await expect(page.getByRole('heading', { name: '第一次保存' })).toHaveCount(
      0,
    );
    expect(errors).toEqual([]);
  });

  test('删除作品后条目消失，刷新后也不会回来', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await resetDatabase(page);
    await createArtwork(page, '待删除的作品');
    await page.getByRole('button', { name: '保存到藏品' }).click();
    await expect(
      page.getByRole('heading', { name: '待删除的作品' }),
    ).toBeVisible();

    page.on('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: '删除', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('作品已删除。');

    await page.reload();
    await expect(
      page.getByRole('heading', { name: '待删除的作品' }),
    ).toHaveCount(0);
    await expect(page.locator('.artwork')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('保存的作品刷新后仍在，并且能带着两笔笔划重新打开', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await resetDatabase(page);
    await createArtwork(page, '两笔作品', 2);
    await page.getByRole('button', { name: '保存到藏品' }).click();
    await expect(page.getByRole('heading', { name: '两笔作品' })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { name: '两笔作品' })).toBeVisible();

    page.on('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: '打开作品' }).click();
    await expect(page.getByLabel('作品名称')).toHaveValue('两笔作品');
    await page.getByRole('button', { name: '继续彩绘' }).click();
    await expect(page.getByText('已落笔 2 次', { exact: false })).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('存储失败的可见性', () => {
  test('写入失败时给出提示，并且当前作品不会丢失', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await resetDatabase(page);
    await createArtwork(page, '配额不足的作品');

    // 让底层写入抛出配额错误，模拟浏览器存储写满。
    await page.evaluate(() => {
      const holder = window as unknown as {
        __originalPut?: typeof IDBObjectStore.prototype.put;
      };
      holder.__originalPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function failingPut() {
        throw new DOMException('存储配额已满', 'QuotaExceededError');
      };
    });

    await page.getByRole('button', { name: '保存到藏品' }).click();
    await expect(page.getByRole('status')).toContainText('保存失败');
    // 这两句只出现在配额错误（StorageError('quota')）的分支里，
    // 泛化的兜底提示不会包含它们。
    await expect(page.getByRole('status')).toContainText('本地存储空间不足');
    await expect(page.getByRole('status')).toContainText('当前作品仍在');

    // 失败之后当前作品还在：器物和作品名称都没有被清掉。
    await expect(page.getByLabel('三维陶器画布')).toBeVisible();
    await expect(page.getByLabel('作品名称')).toHaveValue('配额不足的作品');
    await expect(page.locator('.artwork')).toHaveCount(0);

    await page.evaluate(() => {
      const holder = window as unknown as {
        __originalPut?: typeof IDBObjectStore.prototype.put;
      };
      if (holder.__originalPut) {
        IDBObjectStore.prototype.put = holder.__originalPut;
        delete holder.__originalPut;
      }
    });

    // 桩子还原之后重试就能存进去：失败是可重试的，不是把作品弄丢了。
    await page.getByRole('button', { name: '保存到藏品' }).click();
    await expect(page.getByRole('status')).toContainText('作品已保存');
    await expect(page.locator('.artwork')).toHaveCount(1);
    await expect(
      page.getByRole('heading', { name: '配额不足的作品' }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test('24 mixed actions survive reload and the full undo window without losing the texture', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await resetDatabase(page);
  await page.getByLabel('截面 4 半径').fill('0.72');
  await page.getByRole('button', { name: '定型进入彩绘' }).click();

  const tools = ['画笔', '印章', '橡皮擦'] as const;
  for (let index = 0; index < 24; index++) {
    await page
      .getByRole('button', { name: tools[index % 3], exact: true })
      .click();
    await drawStroke(page, index % 2 === 0 ? 1 : -1);
    await expect(
      page.getByText(`已落笔 ${index + 1} 次`, { exact: false }),
    ).toBeVisible();
  }
  await page.getByRole('button', { name: '入窑烧制' }).click();
  await expect(page.getByRole('button', { name: '保存到藏品' })).toBeVisible();
  await page.getByLabel('作品名称').fill('24次混合操作');
  await page.getByRole('button', { name: '保存到藏品' }).click();
  await expect(page.getByRole('status')).toContainText('作品已保存');
  const [before] = await readRecords(page);
  const actions = before.actions as PaintingAction[];
  expect(actions).toHaveLength(24);
  expect(actions.map((action) => action.type)).toEqual(
    Array.from(
      { length: 24 },
      (_, index) => ['BRUSH', 'STAMP', 'ERASE'][index % 3],
    ),
  );
  expect(before.textureHash).toMatch(/^[0-9a-f]{64}$/);

  await page.reload();
  page.on('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: '打开作品' }).click();
  await expect(page.getByLabel('作品名称')).toHaveValue('24次混合操作');
  await page.getByRole('button', { name: '继续彩绘' }).click();
  await expect(page.getByText('已落笔 24 次', { exact: false })).toBeVisible();
  const undo = page.getByRole('button', { name: '撤销', exact: true });
  const redo = page.getByRole('button', { name: '重做', exact: true });
  for (let index = 0; index < 20; index++) await undo.click();
  await expect(page.getByText('已落笔 4 次', { exact: false })).toBeVisible();
  await expect(undo).toBeDisabled();
  for (let index = 0; index < 20; index++) await redo.click();
  await expect(page.getByText('已落笔 24 次', { exact: false })).toBeVisible();
  await expect(redo).toBeDisabled();

  await page.getByRole('button', { name: '入窑烧制' }).click();
  await expect(page.getByRole('button', { name: '保存到藏品' })).toBeVisible();
  await page.getByRole('button', { name: '保存到藏品' }).click();
  await expect(page.getByRole('status')).toContainText('作品已保存');
  const records = await readRecords(page);
  expect(records).toHaveLength(1);
  expect(records[0].key).toBe(before.key);
  expect(records[0].actions).toEqual(actions);
  expect(records[0].profile).toEqual(before.profile);
  // The renderer replays all three tools after opening and undo/redo.
  // Matching the actual exported texture catches visual loss beyond action counts.
  expect(records[0].textureHash).toBe(before.textureHash);
  expect(errors).toEqual([]);
});

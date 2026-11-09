import { expect, test, type Page } from '@playwright/test';
import type { StudioArtworkV2 } from '../../src/types/artwork';

async function readSeamArtwork(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('porcelain-tales-studio');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const records = await new Promise<StudioArtworkV2[]>((resolve, reject) => {
      const request = db
        .transaction('artworks')
        .objectStore('artworks')
        .getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).finally(() => db.close());
    if (records.length !== 1)
      throw new Error(`Expected one artwork, got ${records.length}`);
    const record = records[0];
    const action = record.actions[0];
    if (action?.type !== 'BRUSH' || !record.texture)
      throw new Error('Expected a saved brush action and texture');
    const path = action.path;
    const crossing = path
      .slice(1)
      .findIndex(
        (point, index) => Math.floor(point.u) !== Math.floor(path[index].u),
      );
    if (crossing < 0)
      throw new Error('Pointer input did not actually cross U=0/1');
    const a = path[crossing];
    const b = path[crossing + 1];
    const seam = Math.ceil(Math.min(a.u, b.u));
    const ratio = (seam - a.u) / (b.u - a.u);
    const v = a.v + (b.v - a.v) * ratio;
    const bitmap = await createImageBitmap(record.texture);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const { width, height } = canvas;
    const pixels = ctx.getImageData(0, 0, width, height).data;
    const ink = (x: number, y: number) => {
      const index = (y * width + x) * 4;
      return pixels[index + 2] - pixels[index] > 25;
    };
    const row = Math.round((1 - v) * height);
    // Every column next to each texture edge must contain the crossing ink.
    const edgeColumns = [0, 1, 2, width - 3, width - 2, width - 1].map((x) => {
      let count = 0;
      for (
        let y = Math.max(0, row - action.size);
        y <= Math.min(height - 1, row + action.size);
        y++
      ) {
        if (ink(x, y)) count++;
      }
      return count;
    });
    let totalInk = 0;
    let oppositeInk = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!ink(x, y)) continue;
        totalInk++;
        if (Math.abs(x - width / 2) < 16) oppositeInk++;
      }
    }
    const digest = await crypto.subtle.digest(
      'SHA-256',
      await record.texture.arrayBuffer(),
    );
    return {
      id: record.id,
      actions: record.actions,
      path,
      width,
      height,
      edgeColumns,
      totalInk,
      oppositeInk,
      textureHash: Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join(''),
    };
  });
}

for (const direction of ['left-to-right', 'right-to-left'] as const) {
  test(`real ${direction} seam crossing stays continuous after undo and reload`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/?prologue=skip');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('button', { name: '定型进入彩绘' }).click();
    await page.getByLabel('笔刷粗细').selectOption('24');
    const canvas = page.getByLabel('三维陶器画布');
    // Detect the vessel silhouette in a rendered frame instead of guessing
    // coordinates that might hit only the background on a different viewport.
    const span = await canvas.evaluate(
      (el: HTMLCanvasElement) =>
        new Promise<{
          left: number;
          right: number;
          row: number;
          width: number;
          height: number;
        }>((resolve) =>
          requestAnimationFrame(() => {
            const copy = document.createElement('canvas');
            copy.width = el.width;
            copy.height = el.height;
            const ctx = copy.getContext('2d')!;
            ctx.drawImage(el, 0, 0);
            const row = Math.floor(el.height * 0.52);
            const pixels = ctx.getImageData(0, row, el.width, 1).data;
            const foreground = (x: number) =>
              Math.abs(pixels[x * 4] - 233) > 8 ||
              Math.abs(pixels[x * 4 + 1] - 230) > 8 ||
              Math.abs(pixels[x * 4 + 2] - 222) > 8;
            const columns = Array.from(
              { length: el.width },
              (_, x) => x,
            ).filter(foreground);
            resolve({
              left: Math.min(...columns),
              right: Math.max(...columns),
              row,
              width: el.width,
              height: el.height,
            });
          }),
        ),
    );
    expect(span.right - span.left).toBeGreaterThan(40);
    const rect = (await canvas.boundingBox())!;
    const left = rect.x + ((span.left + 10) / span.width) * rect.width;
    const right = rect.x + ((span.right - 10) / span.width) * rect.width;
    const y = rect.y + (span.row / span.height) * rect.height;
    await page.mouse.move(direction === 'left-to-right' ? left : right, y);
    await page.mouse.down();
    await page.mouse.move(direction === 'left-to-right' ? right : left, y, {
      steps: 12,
    });
    await page.mouse.up();
    await expect(page.getByText('已落笔 1 次', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await expect(page.getByText('已落笔 0 次', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: '重做', exact: true }).click();
    const save = async () => {
      await page.getByRole('button', { name: '入窑烧制' }).click();
      await expect(
        page.getByRole('button', { name: '保存到藏品' }),
      ).toBeVisible();
      await page.getByRole('button', { name: '保存到藏品' }).click();
      await expect(page.getByRole('status')).toContainText('作品已保存');
    };
    await save();
    const before = await readSeamArtwork(page);
    expect(before.actions).toHaveLength(1);
    expect(before.width).toBe(2048);
    expect(before.height).toBe(2048);
    const us = before.path.map((point) => point.u);
    expect(Math.max(...us) - Math.min(...us)).toBeLessThan(0.5);
    const delta = us[us.length - 1] - us[0];
    expect(direction === 'left-to-right' ? delta : -delta).toBeGreaterThan(0);
    for (const count of before.edgeColumns) expect(count).toBeGreaterThan(0);
    expect(before.totalInk).toBeGreaterThan(100);
    expect(before.oppositeInk).toBe(0);

    await page.reload();
    page.on('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: '打开作品' }).click();
    await page.getByRole('button', { name: '继续彩绘' }).click();
    await expect(page.getByText('已落笔 1 次', { exact: false })).toBeVisible();
    await save();
    const after = await readSeamArtwork(page);
    expect(after).toEqual(before);
    expect(errors).toEqual([]);
    await testInfo.attach('seam-texture-evidence', {
      body: JSON.stringify(before, null, 2),
      contentType: 'application/json',
    });
  });
}

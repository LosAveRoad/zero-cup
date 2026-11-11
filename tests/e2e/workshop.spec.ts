import { expect, test, type Page } from '@playwright/test';

const CANVAS_LABEL = '三维陶器画布';

/** 一条 UV 纹理上「青花」像素的分布统计。 */
interface TextureInk {
  width: number;
  height: number;
  /** 蓝通道明显高于红通道的像素数。 */
  ink: number;
  /** 器腹内，四周相距 12 个纹理像素仍是青花的像素数。 */
  solidBodyInk: number;
  /** 沿 u 方向均分 64 档的墨量剖面。 */
  uProfile: number[];
  /** 墨迹覆盖的 v 范围（0 在底部）。 */
  minV: number;
  maxV: number;
}

/** u 剖面中被视为「有墨」的最小像素数（忽略抗锯齿边缘）。 */
const BAND_MIN_INK = 12;

/** 把 u 剖面切成首尾相接的连通段。 */
function countGroups(uProfile: number[]): number {
  const occupied = uProfile.map((count) => count >= BAND_MIN_INK);
  if (occupied.every(Boolean)) return 1;
  let groups = 0;
  for (let i = 0; i < occupied.length; i++) {
    const previous = occupied[(i + occupied.length - 1) % occupied.length];
    if (occupied[i] && !previous) groups++;
  }
  return groups;
}

/** u 剖面中达到阈值的档数。 */
function occupiedBands(uProfile: number[]): number {
  return uProfile.filter((count) => count >= BAND_MIN_INK).length;
}

/** 进入彩绘阶段并返回画布盒。 */
async function enterPainting(page: Page) {
  await page.goto('/?prologue=skip');
  await page.getByRole('button', { name: '定型进入彩绘' }).click();
  const canvas = page.getByLabel(CANVAS_LABEL);
  await expect(canvas).toBeVisible();
  return (await canvas.boundingBox())!;
}

/** 在画布上从左到右画一笔。 */
async function drawStroke(
  page: Page,
  box: { x: number; y: number; width: number; height: number },
  offsetY = 0,
) {
  const y = box.y + box.height * 0.5 + offsetY;
  await page.mouse.move(box.x + box.width * 0.47, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, y, { steps: 6 });
  await page.mouse.up();
}

/** 烧制并保存，然后读出持久化的彩绘纹理做像素统计。 */
async function fireSaveAndReadTexture(page: Page): Promise<TextureInk | null> {
  await page.getByRole('button', { name: '入窑烧制' }).click();
  await expect(page.getByRole('heading', { name: '成品工作台' })).toBeVisible({
    timeout: 10_000,
  });
  await page.getByRole('button', { name: '保存到藏品' }).click();
  await expect(
    page.getByText('作品已保存到此浏览器', { exact: false }),
  ).toBeVisible({ timeout: 15_000 });

  return page.evaluate(async () => {
    const openDb = () =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('porcelain-tales-studio');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    const db = await openDb();
    const record = await new Promise<Record<string, unknown> | undefined>(
      (resolve, reject) => {
        const tx = db.transaction('artworks', 'readonly');
        const request = tx.objectStore('artworks').getAll();
        request.onsuccess = () =>
          resolve((request.result as Record<string, unknown>[])[0]);
        request.onerror = () => reject(request.error);
      },
    );
    const blob = record?.texture as Blob | undefined;
    if (!blob) return null;
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const uProfile = new Array<number>(64).fill(0);
    let ink = 0;
    let solidBodyInk = 0;
    const isInk = (i: number) => data[i + 2] - data[i] > 25;
    const verticalOffset = 12 * canvas.width * 4;
    let minV = 1;
    let maxV = 0;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const i = (y * canvas.width + x) * 4;
        // 青花钴料：蓝通道显著高于红通道；素坯与背景不满足。
        if (!isInk(i)) continue;
        ink++;
        uProfile[Math.min(63, Math.floor((x / canvas.width) * 64))]++;
        const v = 1 - y / canvas.height;
        if (
          v > 0.3 &&
          v < 0.65 &&
          x >= 12 &&
          x < canvas.width - 12 &&
          isInk(i - 48) &&
          isInk(i + 48) &&
          isInk(i - verticalOffset) &&
          isInk(i + verticalOffset)
        )
          solidBodyInk++;
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
      }
    }
    return {
      width: canvas.width,
      height: canvas.height,
      ink,
      solidBodyInk,
      uProfile,
      minV,
      maxV,
    };
  });
}

test.describe('彩绘工坊新增工具', () => {
  test('彩绘阶段右键拖动可以旋转视角，左右两笔落在不同方位', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const box = await enterPainting(page);

    await drawStroke(page, box);
    await expect(page.getByText('已落笔 1 次', { exact: false })).toBeVisible();

    // 右键拖动旋转半个身位：修复前 OrbitControls 已忽略这次按下，落点不会变。
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(box.x + box.width / 2 + 200, box.y + box.height / 2, {
      steps: 12,
    });
    await page.mouse.up({ button: 'right' });

    await drawStroke(page, box);
    await expect(page.getByText('已落笔 2 次', { exact: false })).toBeVisible();

    const texture = await fireSaveAndReadTexture(page);
    expect(texture).not.toBeNull();
    // 两笔在同一屏幕位置落笔，只有视角真的转过才会出现两处分离的墨。
    expect(countGroups(texture!.uProfile)).toBeGreaterThanOrEqual(2);
    expect(errors).toEqual([]);
  });

  test('普通画笔不显示对称旋绘或瓶身拓印工具', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await enterPainting(page);
    await expect(page.getByRole('button', { name: '四方开光' })).toHaveCount(0);
    await expect(page.getByText(/非遗对称|瓶身拓印/)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('印章栏的非遗对称工艺将一枚印章铺成四方', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await enterPainting(page);
    await page.getByRole('button', { name: '印章', exact: true }).click();
    await page.getByRole('button', { name: '对称工艺：四方开光' }).click();
    const canvas = page.getByLabel(CANVAS_LABEL);
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByText('已落笔 1 次', { exact: false })).toBeVisible();

    const texture = await fireSaveAndReadTexture(page);
    expect(texture).not.toBeNull();
    expect(countGroups(texture!.uProfile)).toBe(4);
    expect(errors).toEqual([]);
  });

  test('青叶与团莲填色印章可视化展示并可选中', async ({ page }) => {
    await enterPainting(page);
    await page.getByRole('button', { name: '印章', exact: true }).click();
    const gallery = page.getByRole('group', { name: '可横向选择的青花纹样' });
    for (const name of ['青叶填色', '团莲填色', '蓝地回纹']) {
      const stamp = gallery.getByRole('button', { name });
      await expect(stamp.locator('svg')).toBeVisible();
      await stamp.click();
      await expect(stamp).toHaveAttribute('aria-pressed', 'true');
    }
  });

  test('末尾三款填色印章的悬停预览保持常规尺寸', async ({ page }) => {
    await enterPainting(page);
    await page.getByRole('button', { name: '印章', exact: true }).click();
    const gallery = page.getByRole('group', { name: '可横向选择的青花纹样' });
    const canvas = page.getByLabel(CANVAS_LABEL);
    const box = (await canvas.boundingBox())!;
    const cursor = page.locator('.tool-cursor-overlay');

    for (const name of ['青叶填色', '团莲填色', '蓝地回纹']) {
      await gallery.getByRole('button', { name, exact: true }).click();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      const transform = await cursor.evaluate((svg) =>
        svg.children[1]?.children[0]?.getAttribute('transform'),
      );
      const previewScale = Number(transform?.match(/scale\(([\d.]+)/)?.[1]);
      expect(previewScale).toBeGreaterThan(0.45);
      expect(previewScale).toBeLessThan(0.7);
    }
  });

  test('旋坯叶片对称填色，悬停预览后铺设一周', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await enterPainting(page);

    await page.getByRole('button', { name: '旋坯环绘', exact: true }).click();
    await expect(
      page.getByRole('region', { name: '旋坯环绘纹样' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /如意连云|并蒂莲瓣/ }),
    ).toHaveCount(0);
    for (const name of ['团莲环饰', '回纹连方'])
      await expect(page.getByRole('button', { name })).toBeVisible();
    await page.getByRole('button', { name: '叶片连饰' }).click();
    const size = page.getByRole('slider', { name: '旋坯纹样尺寸' });
    await size.fill('2.4');
    await expect(size).toHaveValue('2.4');
    await expect(page.getByText('已落笔 0 次', { exact: false })).toBeVisible();
    const canvas = page.getByLabel(CANVAS_LABEL);
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(canvas).toHaveAttribute('data-cursor', 'brush-reticle');
    await expect(page.getByText('已落笔 0 次', { exact: false })).toBeVisible();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByText('已落笔 1 次', { exact: false })).toBeVisible();
    const texture = await fireSaveAndReadTexture(page);
    expect(texture).not.toBeNull();
    expect(occupiedBands(texture!.uProfile)).toBeGreaterThan(35);
    // Filled leaf silhouettes may visually join in the coarse 64-bin profile;
    // full wrap coverage and a bounded height are the stable checks here.
    expect(texture!.maxV - texture!.minV).toBeLessThan(0.3);
    expect(errors).toEqual([]);
  });

  test('直线环带可以铺满器身一圈', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await enterPainting(page);

    await page.getByRole('button', { name: '旋坯环绘', exact: true }).click();
    await page.getByRole('button', { name: '直线环带' }).click();
    const box = (await page.getByLabel(CANVAS_LABEL).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByText('已落笔 1 次', { exact: false })).toBeVisible();

    const texture = await fireSaveAndReadTexture(page);
    expect(texture).not.toBeNull();
    expect(occupiedBands(texture!.uProfile)).toBe(texture!.uProfile.length);
    expect(texture!.maxV - texture!.minV).toBeLessThan(0.3);
    expect(errors).toEqual([]);
  });

  test('经典名品快绘一次绘入多段纹样', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await enterPainting(page);

    await page.getByRole('button', { name: '模版', exact: true }).click();
    const presets = page.getByRole('region', { name: '经典名品青花快绘' });
    await expect(presets.getByRole('button')).toHaveCount(3);
    await expect(
      presets.getByRole('button', { name: /折枝三果/ }),
    ).toBeVisible();
    await expect(
      presets.getByRole('button', { name: /留白走马/ }),
    ).toBeVisible();
    await page.getByRole('button', { name: /缠枝宝相莲/ }).click();
    await expect(page.getByText('已落笔 9 次', { exact: false })).toBeVisible();

    const texture = await fireSaveAndReadTexture(page);
    expect(texture).not.toBeNull();
    // 通景箍线与缠枝莲覆盖整圈。
    expect(occupiedBands(texture!.uProfile)).toBe(texture!.uProfile.length);
    expect(texture!.solidBodyInk).toBeGreaterThan(20_000);
    expect(errors).toEqual([]);
  });

  test('名窑釉彩随作品保存，重开仍是哥窑金丝', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', (dialog) => void dialog.accept());
    await enterPainting(page);

    await page.getByRole('button', { name: '入窑烧制' }).click();
    await expect(page.getByRole('heading', { name: '成品工作台' })).toBeVisible(
      {
        timeout: 10_000,
      },
    );
    await page.getByRole('button', { name: '哥窑金丝' }).click();
    await expect(
      page.getByRole('button', { name: '哥窑金丝' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: '保存到藏品' }).click();
    await expect(
      page.getByText('作品已保存到此浏览器', { exact: false }),
    ).toBeVisible();

    await page.reload();
    await page.getByRole('button', { name: /我的作品/ }).click();
    await page.getByRole('button', { name: '打开作品' }).click();
    await expect(
      page.getByRole('button', { name: '哥窑金丝' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(
      page.getByRole('button', { name: '枢府甜白' }),
    ).toHaveAttribute('aria-pressed', 'false');
    expect(errors).toEqual([]);
  });

  test('线框透视可以开关且不报错', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await enterPainting(page);

    const toggle = page.getByRole('button', { name: /数学网格透视/ });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    const off = page.getByRole('button', { name: /隐藏拓扑网格/ });
    await expect(off).toHaveAttribute('aria-pressed', 'true');
    await off.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(errors).toEqual([]);
  });
});

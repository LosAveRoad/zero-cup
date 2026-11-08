import { expect, test, type Page } from '@playwright/test';

const CANVAS_LABEL = '三维陶器画布';

/**
 * 蓝通道减去红通道：青花（#174a94）为正，瓷坯（#faf7ef 受光后）为负。
 * 背景（#e9e6de）的差值接近 0，所以这个指标能把墨迹和坯体分开。
 */
const INK_THRESHOLD = 25;

interface CanvasBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RegionStats {
  ink: number;
  mean: [number, number, number];
  blueExcess: number;
}

interface CanvasStats {
  width: number;
  height: number;
  totalInk: number;
  inkBox: { minX: number; minY: number; maxX: number; maxY: number } | null;
  span: { left: number; right: number };
  region: RegionStats | null;
  /** 该行上下各 8 像素内含有墨迹的列。 */
  band: number[];
}

/** 进入彩绘阶段并等画布尺寸稳定。 */
async function enterPainting(page: Page): Promise<CanvasBox> {
  await page.getByRole('button', { name: '定型进入彩绘' }).click();
  return settleCanvas(page);
}

/**
 * 切换工具会改变工具面板的高度，画布随之缩放，相机的宽高比也随之改变。
 * 所以每次换工具之后都要等画布稳定下来，再重新量取它的位置。
 */
async function settleCanvas(page: Page): Promise<CanvasBox> {
  await page.evaluate(async () => {
    const el = document.querySelector(
      'canvas[aria-label="三维陶器画布"]',
    ) as HTMLCanvasElement;
    let previous = '';
    let stable = 0;
    for (let frame = 0; frame < 180; frame++) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      const box = el.getBoundingClientRect();
      const key = `${Math.round(box.width)}x${Math.round(box.height)}/${el.width}x${el.height}`;
      stable = key === previous ? stable + 1 : 0;
      previous = key;
      if (stable >= 2) return;
    }
  });
  const box = await page.getByLabel(CANVAS_LABEL).boundingBox();
  return box!;
}

/**
 * 读取 WebGL 画布的像素。
 *
 * renderer 没有开 preserveDrawingBuffer，所以只有在同一帧里把画布画进 2D
 * 画布才能读到内容；因此这里在 requestAnimationFrame 回调里做 drawImage。
 * 统计在页面里算好再回传，避免把整幅图的数据搬过进程边界。
 */
async function analyse(
  page: Page,
  row: number,
  region?: { minX: number; minY: number; maxX: number; maxY: number },
): Promise<CanvasStats> {
  return page.evaluate(
    ({ row, region, threshold }) =>
      new Promise((resolve) => {
        let frames = 0;
        const tick = () => {
          if (++frames < 10) {
            requestAnimationFrame(tick);
            return;
          }
          const el = document.querySelector(
            'canvas[aria-label="三维陶器画布"]',
          ) as HTMLCanvasElement;
          const copy = document.createElement('canvas');
          copy.width = el.width;
          copy.height = el.height;
          const ctx = copy.getContext('2d')!;
          ctx.drawImage(el, 0, 0);
          const pixels = ctx.getImageData(0, 0, el.width, el.height).data;
          const isInk = (index: number) =>
            pixels[index + 2] - pixels[index] > threshold;
          const at = (x: number, y: number) => (y * el.width + x) * 4;

          let totalInk = 0;
          let minX = Infinity;
          let minY = Infinity;
          let maxX = -1;
          let maxY = -1;
          for (let y = 0; y < el.height; y++) {
            for (let x = 0; x < el.width; x++) {
              if (!isInk(at(x, y))) continue;
              totalInk++;
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }

          // 器身左右边缘：该行上不是背景色的像素范围。
          const background = (index: number) =>
            Math.abs(pixels[index] - 233) < 8 &&
            Math.abs(pixels[index + 1] - 230) < 8 &&
            Math.abs(pixels[index + 2] - 222) < 8;
          let left = -1;
          let right = -1;
          for (let x = 0; x < el.width; x++) {
            if (background(at(x, row))) continue;
            if (left < 0) left = x;
            right = x;
          }

          let regionStats: RegionStats | null = null;
          if (region) {
            let ink = 0;
            let r = 0;
            let g = 0;
            let b = 0;
            let count = 0;
            for (let y = region.minY; y <= region.maxY; y++) {
              for (let x = region.minX; x <= region.maxX; x++) {
                const index = at(x, y);
                if (isInk(index)) ink++;
                r += pixels[index];
                g += pixels[index + 1];
                b += pixels[index + 2];
                count++;
              }
            }
            regionStats = {
              ink,
              mean: [r / count, g / count, b / count],
              blueExcess: (b - r) / count,
            };
          }

          // 该行上下各 8 像素内含有墨迹的列，用来检查笔迹是否连续。
          const inkedColumns: number[] = [];
          for (let x = 0; x < el.width; x++) {
            for (let y = row - 8; y <= row + 8; y++) {
              if (y < 0 || y >= el.height) continue;
              if (!isInk(at(x, y))) continue;
              inkedColumns.push(x);
              break;
            }
          }

          resolve({
            width: el.width,
            height: el.height,
            totalInk,
            inkBox: totalInk > 0 ? { minX, minY, maxX, maxY } : null,
            span: { left, right },
            region: regionStats,
            band: inkedColumns,
          });
        };
        requestAnimationFrame(tick);
      }),
    { row, region: region ?? null, threshold: INK_THRESHOLD },
  );
}

/** 画布像素坐标 → 页面坐标。 */
function toPage(
  box: CanvasBox,
  canvas: { width: number; height: number },
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: box.x + (x * box.width) / canvas.width,
    y: box.y + (y * box.height) / canvas.height,
  };
}

/** 等到画面停止变化（OrbitControls 的阻尼需要时间收敛）。 */
async function waitForStableView(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const el = document.querySelector(
          'canvas[aria-label="三维陶器画布"]',
        ) as HTMLCanvasElement;
        const capture = () => {
          const copy = document.createElement('canvas');
          copy.width = el.width;
          copy.height = el.height;
          const ctx = copy.getContext('2d')!;
          ctx.drawImage(el, 0, 0);
          return ctx.getImageData(0, 0, el.width, el.height).data;
        };
        const wait = (frames: number) =>
          new Promise<void>((done) => {
            let left = frames;
            const tick = () =>
              left-- <= 0 ? done() : requestAnimationFrame(tick);
            requestAnimationFrame(tick);
          });
        const run = async () => {
          let previous = capture();
          for (let attempt = 0; attempt < 60; attempt++) {
            await wait(10);
            const current = capture();
            let difference = 0;
            for (let i = 0; i < current.length; i++) {
              difference += Math.abs(current[i] - previous[i]);
            }
            previous = current;
            if (difference / current.length < 0.2) {
              resolve();
              return;
            }
          }
          resolve();
        };
        void run();
      }),
  );
}

test.describe('绘制工具 / painting tools', () => {
  test('画笔、橡皮擦、印章互斥，只有当前工具处于激活状态', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: '瓷器物语', exact: true }),
    ).toBeVisible();
    await enterPainting(page);

    const brush = page.getByRole('button', { name: '画笔', exact: true });
    const eraser = page.getByRole('button', { name: '橡皮擦', exact: true });
    const stamp = page.getByRole('button', { name: '印章', exact: true });

    await expect(brush).toHaveAttribute('aria-pressed', 'true');
    await expect(eraser).toHaveAttribute('aria-pressed', 'false');
    await expect(stamp).toHaveAttribute('aria-pressed', 'false');

    await eraser.click();
    await expect(eraser).toHaveAttribute('aria-pressed', 'true');
    await expect(brush).toHaveAttribute('aria-pressed', 'false');
    await expect(stamp).toHaveAttribute('aria-pressed', 'false');

    await stamp.click();
    await expect(stamp).toHaveAttribute('aria-pressed', 'true');
    await expect(brush).toHaveAttribute('aria-pressed', 'false');
    await expect(eraser).toHaveAttribute('aria-pressed', 'false');

    await brush.click();
    await expect(brush).toHaveAttribute('aria-pressed', 'true');
    await expect(eraser).toHaveAttribute('aria-pressed', 'false');
    await expect(stamp).toHaveAttribute('aria-pressed', 'false');

    expect(errors).toEqual([]);
  });
});

test.describe('撤销与重做 / undo and redo', () => {
  test('画一笔后计数加一，撤销归零、重做回到一', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    const canvas = page.getByLabel(CANVAS_LABEL);
    await expect(canvas).toBeVisible();
    const box = await enterPainting(page);
    const stats = await analyse(page, Math.floor(box.height * 0.52));
    const start = toPage(
      box,
      stats,
      stats.span.left + 25,
      Math.floor(stats.height * 0.52),
    );

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 30, start.y - 8, { steps: 6 });
    await page.mouse.up();
    await expect(page.getByText('已落笔 1 次', { exact: false })).toBeVisible();

    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await expect(page.getByText('已落笔 0 次', { exact: false })).toBeVisible();
    await expect(
      page.getByRole('button', { name: '重做', exact: true }),
    ).toBeEnabled();

    await page.getByRole('button', { name: '重做', exact: true }).click();
    await expect(page.getByText('已落笔 1 次', { exact: false })).toBeVisible();
    await expect(
      page.getByRole('button', { name: '重做', exact: true }),
    ).toBeDisabled();

    expect(errors).toEqual([]);
  });

  test('撤销之后再落笔会丢弃重做分支', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    const canvas = page.getByLabel(CANVAS_LABEL);
    await expect(canvas).toBeVisible();
    const box = await enterPainting(page);
    const stats = await analyse(page, Math.floor(box.height * 0.52));
    const start = toPage(
      box,
      stats,
      stats.span.left + 25,
      Math.floor(stats.height * 0.52),
    );

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 30, start.y - 8, { steps: 6 });
    await page.mouse.up();
    await expect(page.getByText('已落笔 1 次', { exact: false })).toBeVisible();

    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await expect(page.getByText('已落笔 0 次', { exact: false })).toBeVisible();

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 30, start.y - 8, { steps: 6 });
    await page.mouse.up();
    await expect(page.getByText('已落笔 1 次', { exact: false })).toBeVisible();
    await expect(
      page.getByRole('button', { name: '重做', exact: true }),
    ).toBeDisabled();

    expect(errors).toEqual([]);
  });
});

test.describe('橡皮擦 / eraser', () => {
  test('橡皮擦擦掉花纹，露出的仍是瓷坯而不是透明', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    const canvas = page.getByLabel(CANVAS_LABEL);
    await expect(canvas).toBeVisible();
    let box = await enterPainting(page);
    const stats = await analyse(page, Math.floor(box.height * 0.52));
    const row = Math.floor(stats.height * 0.52);
    const start = toPage(box, stats, stats.span.left + 25, row);

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 40, start.y, { steps: 6 });
    await page.mouse.up();
    await expect(page.getByText('已落笔 1 次', { exact: false })).toBeVisible();

    // 换工具会让工具面板变矮，画布随之缩放，相机宽高比也跟着变，
    // 于是墨迹在屏幕上的位置会移动：擦除前要重新定位它。
    await page.getByRole('button', { name: '橡皮擦', exact: true }).click();
    box = await settleCanvas(page);
    const live = await analyse(page, 0);
    expect(live.inkBox).not.toBeNull();
    const region = {
      minX: live.inkBox!.minX,
      minY: live.inkBox!.minY,
      maxX: live.inkBox!.maxX,
      maxY: live.inkBox!.maxY,
    };
    const liveRow = Math.floor((region.minY + region.maxY) / 2);

    const inked = await analyse(page, liveRow, region);
    expect(inked.region!.ink).toBeGreaterThan(0);

    // 记录同一块像素在没有墨迹时的样子，作为“瓷坯”的参照色。
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await expect(page.getByText('已落笔 0 次', { exact: false })).toBeVisible();
    const pristine = await analyse(page, liveRow, region);
    expect(pristine.region!.ink).toBe(0);
    await page.getByRole('button', { name: '重做', exact: true }).click();
    await expect(page.getByText('已落笔 1 次', { exact: false })).toBeVisible();

    const from = toPage(box, live, region.minX - 8, liveRow);
    const to = toPage(box, live, region.maxX + 8, liveRow);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await page.mouse.up();
    await expect(page.getByText('已落笔 2 次', { exact: false })).toBeVisible();

    const erased = await analyse(page, liveRow, region);
    // 花纹没了。
    expect(erased.region!.ink).toBe(0);
    // 露出来的是瓷坯：和同一块地方没有墨迹时完全一致，
    // 而不是墨色，也不是背景色或透明。
    expect(
      Math.max(
        ...erased.region!.mean.map((value, index) =>
          Math.abs(value - pristine.region!.mean[index]),
        ),
      ),
    ).toBeLessThanOrEqual(12);
    expect(erased.region!.mean[0] - erased.region!.mean[1]).toBeGreaterThan(12);
    expect(erased.region!.blueExcess).toBeLessThan(
      inked.region!.blueExcess - 40,
    );

    expect(errors).toEqual([]);
  });
});

test.describe('印章 / stamps', () => {
  test('落印后计数加一，纹样按钮切换图案', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    const canvas = page.getByLabel(CANVAS_LABEL);
    await expect(canvas).toBeVisible();
    let box = await enterPainting(page);
    await page.getByRole('button', { name: '印章', exact: true }).click();
    box = await settleCanvas(page);
    const stats = await analyse(page, Math.floor(box.height * 0.5));
    const spot = toPage(
      box,
      stats,
      stats.span.left + 25,
      Math.floor(stats.height * 0.42),
    );

    await page.mouse.click(spot.x, spot.y);
    await expect(page.getByText('已落笔 1 次', { exact: false })).toBeVisible();
    const stamped = await analyse(page, Math.floor(box.height * 0.5));
    expect(stamped.totalInk).toBeGreaterThan(0);

    const lotus = page.getByRole('button', { name: '缠枝莲', exact: true });
    const seaside = page.getByRole('button', { name: '海水江崖', exact: true });
    const cloud = page.getByRole('button', { name: '云纹', exact: true });
    await expect(lotus).toHaveAttribute('aria-pressed', 'true');
    await expect(seaside).toHaveAttribute('aria-pressed', 'false');
    await expect(cloud).toHaveAttribute('aria-pressed', 'false');

    await seaside.click();
    await expect(seaside).toHaveAttribute('aria-pressed', 'true');
    await expect(lotus).toHaveAttribute('aria-pressed', 'false');
    await expect(cloud).toHaveAttribute('aria-pressed', 'false');

    await cloud.click();
    await expect(cloud).toHaveAttribute('aria-pressed', 'true');
    await expect(lotus).toHaveAttribute('aria-pressed', 'false');
    await expect(seaside).toHaveAttribute('aria-pressed', 'false');

    expect(errors).toEqual([]);
  });

  test('缩放与旋转只作用于下一枚印章，落印后控件复位', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    const canvas = page.getByLabel(CANVAS_LABEL);
    await expect(canvas).toBeVisible();
    let box = await enterPainting(page);
    await page.getByRole('button', { name: '印章', exact: true }).click();
    box = await settleCanvas(page);
    const stats = await analyse(page, Math.floor(box.height * 0.5));
    const spot = toPage(
      box,
      stats,
      stats.span.left + 25,
      Math.floor(stats.height * 0.42),
    );

    const scale = page.getByLabel('印章缩放');
    const rotation = page.getByLabel('印章旋转');
    await expect(scale).toHaveValue('1');
    await expect(rotation).toHaveValue('0');

    // 放大后再落一枚印，印章应当比默认尺寸大。
    await scale.fill('2');
    await expect(scale).toHaveValue('2');
    await page.mouse.click(spot.x, spot.y);
    await expect(page.getByText('已落笔 1 次', { exact: false })).toBeVisible();
    const scaled = await analyse(page, Math.floor(box.height * 0.5));
    const scaledBox = scaled.inkBox!;

    // 缩放和旋转只属于这一枚印章，落印后控件回到默认值。
    await expect(scale).toHaveValue('1');
    await expect(rotation).toHaveValue('0');
    await expect(page.locator('label', { hasText: '印章缩放' })).toContainText(
      '1.00 倍',
    );
    await expect(page.locator('label', { hasText: '印章旋转' })).toContainText(
      '0°',
    );

    // 同一位置用默认尺寸再落一枚，面积应当更小。
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await expect(page.getByText('已落笔 0 次', { exact: false })).toBeVisible();
    await page.mouse.click(spot.x, spot.y);
    await expect(page.getByText('已落笔 1 次', { exact: false })).toBeVisible();
    const plain = await analyse(page, Math.floor(box.height * 0.5));
    const plainBox = plain.inkBox!;
    expect(plainBox.maxX - plainBox.minX).toBeLessThan(
      scaledBox.maxX - scaledBox.minX,
    );
    expect(plainBox.maxY - plainBox.minY).toBeLessThan(
      scaledBox.maxY - scaledBox.minY,
    );

    expect(errors).toEqual([]);
  });
});

test.describe('视角与接缝 / view and seam', () => {
  test('横扫整个器身只算一笔，接缝处不会绕满一圈', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    const canvas = page.getByLabel(CANVAS_LABEL);
    await expect(canvas).toBeVisible();
    const box = await enterPainting(page);
    const stats = await analyse(page, Math.floor(box.height * 0.52));
    const row = Math.floor(stats.height * 0.52);
    const from = toPage(box, stats, stats.span.left + 4, row);
    const to = toPage(box, stats, stats.span.right - 4, row);

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 2 });
    await page.mouse.up();
    await expect(page.getByText('已落笔 1 次', { exact: false })).toBeVisible();

    const band = await analyse(page, row);
    expect(band.totalInk).toBeGreaterThan(100);
    // 笔迹连成一条：中间（接缝处）不能断开。
    const inkedColumns = new Set(band.band);
    const first = Math.min(...inkedColumns);
    const last = Math.max(...inkedColumns);
    expect(last - first).toBeGreaterThan(band.span.right - band.span.left - 20);
    for (let x = first; x <= last; x++) {
      expect(inkedColumns.has(x)).toBe(true);
    }

    // 转到背面：接缝那笔不应该把整圈贴图都画上。
    await page.getByRole('button', { name: '旋转视角' }).click();
    const rotated = await settleCanvas(page);
    const middle = rotated.y + rotated.height / 2;
    await page.mouse.move(rotated.x + rotated.width * 0.85, middle);
    await page.mouse.down();
    await page.mouse.move(
      rotated.x + rotated.width * 0.85 - rotated.height * 0.5,
      middle,
      { steps: 20 },
    );
    await page.mouse.up();
    await waitForStableView(page);
    const back = await analyse(page, row);
    expect(back.totalInk).toBe(0);

    expect(errors).toEqual([]);
  });

  test('旋转视角时拖动不会留下笔迹', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    const canvas = page.getByLabel(CANVAS_LABEL);
    await expect(canvas).toBeVisible();
    const box = await enterPainting(page);
    await page.getByRole('button', { name: '旋转视角' }).click();
    await expect(
      page.getByRole('button', { name: '旋转视角' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(
      page.getByRole('button', { name: '绘制模式' }),
    ).toHaveAttribute('aria-pressed', 'false');

    const stats = await analyse(page, Math.floor(box.height * 0.52));
    const row = Math.floor(stats.height * 0.52);
    const from = toPage(box, stats, stats.span.left + 10, row);
    const to = toPage(box, stats, stats.span.right - 10, row);

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up();
    await expect(page.getByText('已落笔 0 次', { exact: false })).toBeVisible();
    await expect(
      page.getByRole('button', { name: '撤销', exact: true }),
    ).toBeDisabled();

    const after = await analyse(page, row);
    expect(after.totalInk).toBe(0);

    expect(errors).toEqual([]);
  });
});

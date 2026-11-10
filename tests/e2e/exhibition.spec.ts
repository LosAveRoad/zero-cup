import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

/**
 * End-to-end contract for the integrated studio (issue #17 + #18):
 * a locked firing stage, a *continuous* kiln transition, the camera presets
 * and the new 1080×1080 export layout.
 *
 * Colours observed in the exported PNG (software rendered Chromium) and pinned
 * by the export tests below:
 *
 * | region                     | colour                |
 * | -------------------------- | --------------------- |
 * | caption band background    | rgb(245, 242, 233)    |
 * | caption title ink          | rgb(25, 62, 83)       |
 * | caption date ink           | rgb(92, 112, 120)     |
 * | red seal                   | rgb(176, 58, 46)      |
 * | vessel centre (glazed)     | rgb(255, 255, 250)    |
 * | photo background           | rgb(233, 230, 222)    |
 */

/** Collects uncaught page errors so every test can assert the app stayed clean. */
function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/** Shapes a default pot and fires it, landing on the exhibition stage. */
async function fireToExhibition(page: Page): Promise<void> {
  await page.getByRole('button', { name: '定型进入彩绘' }).click();
  await page.getByRole('button', { name: '入窑烧制' }).click();
  await expect(page.getByLabel('作品名称')).toBeVisible();
}

/** Downloads the exported PNG and returns its bytes. */
async function downloadPng(page: Page): Promise<Buffer> {
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载 PNG' }).click();
  const download = await downloadEvent;
  expect(await download.failure()).toBeNull();
  return await readFile((await download.path())!);
}

/** Waits for a number of animation frames so the renderer has caught up. */
async function nextFrames(page: Page, count = 2): Promise<void> {
  await page.evaluate(async (frames) => {
    for (let i = 0; i < frames; i += 1) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    }
  }, count);
}

/**
 * Records the stage labels the firing panel shows, in order.
 *
 * The panel is a read-only view of the firing progress, so the labels are
 * observed through a MutationObserver instead of by polling: the whole firing
 * only lasts 2.5 s and a label can be gone before a poll ever sees it.
 */
async function recordStageLabels(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = window as unknown as {
      labels: (string | null)[];
      stop: () => void;
    };
    store.labels = [];
    const record = () => {
      const heading = document.querySelector('aside h3');
      const label = heading ? heading.textContent : null;
      if (label !== store.labels[store.labels.length - 1])
        store.labels.push(label);
    };
    const observer = new MutationObserver(record);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    store.stop = () => observer.disconnect();
  });
}

/**
 * Stops the stage label recorder and returns the labels it saw.
 *
 * Only call this once the firing has finished: while the kiln is still
 * running, the later labels have not been rendered yet.
 */
async function stageLabels(page: Page): Promise<string[]> {
  const labels = await page.evaluate(() => {
    const store = window as unknown as {
      labels: (string | null)[];
      stop: () => void;
    };
    store.stop();
    return store.labels;
  });
  return labels.filter((label): label is string => label !== null);
}

/**
 * Records, once per animation frame, the value the firing progress bar shows.
 *
 * The renderer is software rendered and paints as few as four frames during
 * the 2.5 s firing, so reading the value twice with a fixed wait can land on
 * the very same number twice. Sampling every frame instead turns "does the
 * bar advance?" into a question about the whole firing, not about one read.
 */
async function recordProgressValues(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = window as unknown as { values: number[] };
    store.values = [];
    const tick = () => {
      const bar = document.querySelector('[role="progressbar"]');
      if (bar) store.values.push(Number(bar.getAttribute('aria-valuenow')));
      if (store.values.length < 600) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** Returns the progress values the recorder saw, in order. */
async function progressValues(page: Page): Promise<number[]> {
  return await page.evaluate(() => {
    const store = window as unknown as { values: number[] };
    return store.values;
  });
}

/** One frame of the firing stage, as seen from inside the page. */
interface FiringFrame {
  /** Was the 烧制进度 progress bar on screen? */
  firing: boolean;
  /** Its aria-valuemin / aria-valuemax, if it was there. */
  valueMin: string | null;
  valueMax: string | null;
  /** Did the panel show a "N% · 剩余 X.X 秒" countdown? */
  countdown: boolean;
  /** Were the gallery and the new-work button locked? */
  open: boolean;
  remove: boolean;
  reset: boolean;
}

/**
 * Records the firing stage once per animation frame.
 *
 * The whole firing lasts 2.5 s and the software renderer only paints a
 * handful of frames in that time, so a single check can easily land after
 * the stage is over. Sampling every frame observes the *whole* stage and
 * cannot miss it, no matter how slow the machine is.
 */
async function recordFiringFrames(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = window as unknown as {
      frames: {
        firing: boolean;
        valueMin: string | null;
        valueMax: string | null;
        countdown: boolean;
        open: boolean;
        remove: boolean;
        reset: boolean;
      }[];
    };
    store.frames = [];
    const button = (text: string) =>
      Array.from(document.querySelectorAll('button')).find(
        (candidate) => candidate.textContent?.trim() === text,
      );
    const tick = () => {
      const bar = document.querySelector('[role="progressbar"]');
      const aside = document.querySelector('aside');
      store.frames.push({
        firing: bar !== null,
        valueMin: bar ? bar.getAttribute('aria-valuemin') : null,
        valueMax: bar ? bar.getAttribute('aria-valuemax') : null,
        countdown: /剩余 \d+\.\d 秒/.test(aside?.textContent ?? ''),
        open: button('打开作品')?.disabled ?? false,
        remove: button('删除')?.disabled ?? false,
        reset: button('新建作品')?.disabled ?? false,
      });
      if (store.frames.length < 600) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** Returns the frames the recorder saw. */
async function firingFrames(page: Page): Promise<FiringFrame[]> {
  return await page.evaluate(() => {
    const store = window as unknown as {
      frames: {
        firing: boolean;
        valueMin: string | null;
        valueMax: string | null;
        countdown: boolean;
        open: boolean;
        remove: boolean;
        reset: boolean;
      }[];
    };
    return store.frames;
  });
}

interface ExportPixels {
  width: number;
  height: number;
  /** Most common colour of the caption band (the rows below the photo). */
  band: number[];
  /** Colour of the pixel in the middle of the photo. */
  middle: number[];
  /** Pixels painted with the exact seal colour. */
  sealPixels: number;
  /** Pixels that are strongly red in the lower part of the export. */
  redPixels: number;
  /** Bounding box of those red pixels. */
  redBox: { minX: number; minY: number; maxX: number; maxY: number } | null;
  /** Pixels painted with the exact caption title ink. */
  titlePixels: number;
  /** Pixels painted with the exact caption date ink. */
  subtitlePixels: number;
}

/**
 * Decodes the exported PNG inside the browser (Image + 2D canvas) and reports
 * the colours the export is built from.
 */
async function decodeExport(page: Page, bytes: Buffer): Promise<ExportPixels> {
  return await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2D context unavailable');
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, image.width, image.height).data;
    const at = (x: number, y: number) => {
      const index = (y * image.width + x) * 4;
      return [data[index], data[index + 1], data[index + 2]];
    };
    const countExact = (colour: number[]) => {
      let total = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (
          data[i] === colour[0] &&
          data[i + 1] === colour[1] &&
          data[i + 2] === colour[2]
        )
          total += 1;
      }
      return total;
    };
    // The caption band is the bottom of the export; report its dominant colour.
    const bandCounts = new Map<string, { colour: number[]; count: number }>();
    for (let y = 940; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const colour = at(x, y);
        const key = colour.join(',');
        const entry = bandCounts.get(key);
        if (entry) entry.count += 1;
        else bandCounts.set(key, { colour, count: 1 });
      }
    }
    let band = [0, 0, 0];
    let best = -1;
    for (const entry of bandCounts.values()) {
      if (entry.count > best) {
        best = entry.count;
        band = entry.colour;
      }
    }
    // Strongly red pixels: the seal is the only red thing in the export.
    let redPixels = 0;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = -1;
    let maxY = -1;
    for (let y = 780; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const index = (y * image.width + x) * 4;
        const r = data[index];
        const g = data[index + 1];
        const b = data[index + 2];
        if (r > 120 && r > g + 50 && r > b + 50) {
          redPixels += 1;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }
    return {
      width: image.width,
      height: image.height,
      band,
      middle: at(540, 540),
      sealPixels: countExact([176, 58, 46]),
      redPixels,
      redBox: redPixels > 0 ? { minX, minY, maxX, maxY } : null,
      titlePixels: countExact([25, 62, 83]),
      subtitlePixels: countExact([92, 112, 120]),
    };
  }, bytes.toString('base64'));
}

/** Counts the pixels that differ between two exports, split by region. */
async function compareExports(
  page: Page,
  first: Buffer,
  second: Buffer,
): Promise<{ bandDiff: number; photoDiff: number }> {
  return await page.evaluate(
    async ([a, b]) => {
      const load = async (base64: string) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('2D context unavailable');
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, image.width, image.height).data;
      };
      const first = await load(a);
      const second = await load(b);
      let bandDiff = 0;
      let photoDiff = 0;
      for (let y = 0; y < 1080; y += 1) {
        for (let x = 0; x < 1080; x += 1) {
          const index = (y * 1080 + x) * 4;
          if (
            first[index] !== second[index] ||
            first[index + 1] !== second[index + 1] ||
            first[index + 2] !== second[index + 2]
          ) {
            if (y >= 940) bandDiff += 1;
            else photoDiff += 1;
          }
        }
      }
      return { bandDiff, photoDiff };
    },
    [first.toString('base64'), second.toString('base64')],
  );
}

test.describe('烧制阶段', () => {
  test('烧制期间进度条出现，画廊与新建按钮被锁定', async ({ page }) => {
    const errors = watchPageErrors(page);
    await page.goto('/?prologue=skip');
    await fireToExhibition(page);

    // Put one finished piece in the gallery so its buttons exist at all.
    await page.getByLabel('作品名称').fill('锁定测试青花瓶');
    await page.getByRole('button', { name: '保存到藏品' }).click();
    await expect(
      page.getByRole('heading', { name: '锁定测试青花瓶' }),
    ).toBeVisible();

    // Outside the firing stage the gallery is usable.
    await expect(page.getByRole('button', { name: '打开作品' })).toBeEnabled();
    await expect(
      page.getByRole('button', { name: '删除', exact: true }),
    ).toBeEnabled();
    await expect(page.getByRole('button', { name: '新建作品' })).toBeEnabled();

    await page.getByRole('button', { name: '继续彩绘' }).click();
    await recordStageLabels(page);
    await recordFiringFrames(page);
    await page.getByRole('button', { name: '入窑烧制' }).click();

    // The progress bar is up as soon as the firing starts. The bar itself
    // lives for the whole firing, unlike the short-lived stage labels.
    const progress = page.getByRole('progressbar', { name: '烧制进度' });
    await expect(progress).toBeVisible();
    await expect(progress).toHaveAttribute('aria-valuemin', '0');
    await expect(progress).toHaveAttribute('aria-valuemax', '100');
    await expect(page.getByText(/剩余 \d+\.\d 秒/)).toBeVisible();

    // The panel walks through the kiln stages in order. The last stage
    // (完成) is never rendered: the panel is replaced by the exhibition
    // stage in the very same update that reaches 100 %.
    //
    // Which stages are actually painted depends on the frame rate - a slow
    // software renderer can step straight from 窑火正盛 to 挂釉 - so the
    // assertion is that the observed labels are a strictly increasing run of
    // the known stages, not that every one of them was shown.
    await expect(page.getByLabel('作品名称')).toBeVisible();
    const labels = await stageLabels(page);
    const order = ['窑火正盛', '升温', '挂釉', '完成'];
    expect(labels.length).toBeGreaterThan(0);
    expect(labels[0]).toBe('窑火正盛');
    const positions = labels.map((label) => order.indexOf(label));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(new Set(labels).size).toBe(labels.length);

    // Every single frame of the firing had the gallery and the new-work
    // button locked, not just the one the assertions above happened to hit.
    const frames = (await firingFrames(page)).filter((frame) => frame.firing);
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      expect(frame.valueMin).toBe('0');
      expect(frame.valueMax).toBe('100');
      expect(frame.countdown).toBe(true);
      expect(frame.open).toBe(true);
      expect(frame.remove).toBe(true);
      expect(frame.reset).toBe(true);
    }

    expect(errors).toEqual([]);
  });

  test('进度条随时间推进，只完成一次且不再回到烧制', async ({ page }) => {
    const errors = watchPageErrors(page);
    await page.goto('/?prologue=skip');
    await page.getByRole('button', { name: '定型进入彩绘' }).click();
    await recordProgressValues(page);
    await page.getByRole('button', { name: '入窑烧制' }).click();

    const progress = page.getByRole('progressbar', { name: '烧制进度' });
    await expect(progress).toBeVisible();
    const first = Number(await progress.getAttribute('aria-valuenow'));
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(100);

    // The value has to grow while the bar is on screen. The samples are
    // read from the recorder, so a bar that detaches cannot be mistaken for
    // a bar that ran to 100.
    await expect
      .poll(
        async () => {
          const values = await progressValues(page);
          return values.length === 0 ? -1 : Math.max(...values);
        },
        { timeout: 4000 },
      )
      .toBeGreaterThan(first);

    // The firing ends exactly once: the finished-piece stage takes over.
    await expect(page.getByLabel('作品名称')).toBeVisible();
    await expect(
      page.locator('nav[aria-label="制作阶段"] span[aria-current="step"]'),
    ).toContainText('成品');

    // Give the app a second to bounce back into a firing state, if it wanted
    // to. A fixed wait is the only way to assert that something does *not*
    // appear within a period of time.
    await page.waitForTimeout(1000);
    await expect(progress).toHaveCount(0);
    await expect(page.getByLabel('作品名称')).toBeVisible();
    await expect(
      page.locator('nav[aria-label="制作阶段"] span[aria-current="step"]'),
    ).toContainText('成品');

    // The bar really climbed, it did not sit still at one number. The
    // recorder samples the DOM once per animation frame, and the panel is
    // replaced on the very frame the kiln finishes, so the highest value it
    // can ever observe depends on the frame rate — under software rendering
    // that is a handful of frames per second. The invariant worth pinning is
    // that the bar travelled most of the way before the stage took over.
    const values = await progressValues(page);
    expect(values.length).toBeGreaterThanOrEqual(2);
    expect(values[0]).toBeLessThan(100);
    expect(Math.max(...values)).toBeGreaterThanOrEqual(75);
    // The bar never went backwards.
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    }

    expect(errors).toEqual([]);
  });
});

test.describe('成品导出', () => {
  test('导出的成品图仍然是 1080×1080 的 PNG', async ({ page }) => {
    const errors = watchPageErrors(page);
    await page.goto('/?prologue=skip');
    await fireToExhibition(page);
    await page.getByLabel('作品名称').fill('尺寸测试青花瓶');

    const imageBytes = await downloadPng(page);
    expect(imageBytes.readUInt32BE(16)).toBe(1080);
    expect(imageBytes.readUInt32BE(20)).toBe(1080);
    expect(imageBytes.length).toBeGreaterThan(10000);

    expect(errors).toEqual([]);
  });

  test('导出带上作品名、日期与红色印章', async ({ page }) => {
    const errors = watchPageErrors(page);
    await page.goto('/?prologue=skip');
    await fireToExhibition(page);
    await page.getByLabel('作品名称').fill('青花瓶甲');

    const first = await downloadPng(page);
    const pixels = await decodeExport(page, first);
    expect(pixels.width).toBe(1080);
    expect(pixels.height).toBe(1080);

    // The caption band is a different colour than the photo above it.
    expect(pixels.band).not.toEqual(pixels.middle);
    expect(pixels.band).toEqual([245, 242, 233]);

    // The red seal is stamped in the lower right of the picture.
    expect(pixels.sealPixels).toBeGreaterThan(2000);
    expect(pixels.redPixels).toBeGreaterThan(2000);
    expect(pixels.redBox).not.toBeNull();
    expect(pixels.redBox!.minX).toBeGreaterThanOrEqual(860);
    expect(pixels.redBox!.maxX).toBeLessThanOrEqual(1010);
    expect(pixels.redBox!.minY).toBeGreaterThanOrEqual(780);
    expect(pixels.redBox!.maxY).toBeLessThanOrEqual(1000);

    // The name and the date are typeset into the caption band.
    expect(pixels.titlePixels).toBeGreaterThan(100);
    expect(pixels.subtitlePixels).toBeGreaterThan(50);

    // Rename the piece: only the caption band may change, the photo may not.
    await page.getByLabel('作品名称').fill('青花瓶乙');
    const second = await downloadPng(page);
    expect(second.equals(first)).toBe(false);
    const diff = await compareExports(page, first, second);
    expect(diff.bandDiff).toBeGreaterThan(0);
    expect(diff.photoDiff).toBe(0);

    expect(errors).toEqual([]);
  });
});

test.describe('成品机位', () => {
  test('俯仰30° 与特写互斥地切换 aria-pressed', async ({ page }) => {
    const errors = watchPageErrors(page);
    await page.goto('/?prologue=skip');
    await fireToExhibition(page);

    const group = page.getByRole('group', { name: '推荐机位' });
    const front = group.getByRole('button', { name: '正视', exact: true });
    const tilt = group.getByRole('button', { name: '俯仰30°', exact: true });
    const closeup = group.getByRole('button', { name: '特写', exact: true });
    const free = group.getByRole('button', { name: '自由旋转', exact: true });

    await expect(front).toHaveAttribute('aria-pressed', 'true');
    await expect(tilt).toHaveAttribute('aria-pressed', 'false');
    await expect(closeup).toHaveAttribute('aria-pressed', 'false');
    await expect(free).toHaveAttribute('aria-pressed', 'false');

    await tilt.click();
    await expect(tilt).toHaveAttribute('aria-pressed', 'true');
    await expect(front).toHaveAttribute('aria-pressed', 'false');
    await expect(closeup).toHaveAttribute('aria-pressed', 'false');
    await expect(free).toHaveAttribute('aria-pressed', 'false');

    await closeup.click();
    await expect(closeup).toHaveAttribute('aria-pressed', 'true');
    await expect(front).toHaveAttribute('aria-pressed', 'false');
    await expect(tilt).toHaveAttribute('aria-pressed', 'false');
    await expect(free).toHaveAttribute('aria-pressed', 'false');

    // The pressed button is not just a flag: each preset has to frame the
    // vessel differently, so the three photos must not be the same picture.
    await front.click();
    await nextFrames(page);
    const frontShot = await downloadPng(page);
    await tilt.click();
    await nextFrames(page);
    const tiltShot = await downloadPng(page);
    await closeup.click();
    await nextFrames(page);
    const closeupShot = await downloadPng(page);

    expect(
      (await compareExports(page, frontShot, tiltShot)).photoDiff,
    ).toBeGreaterThan(1000);
    expect(
      (await compareExports(page, frontShot, closeupShot)).photoDiff,
    ).toBeGreaterThan(1000);
    expect(
      (await compareExports(page, tiltShot, closeupShot)).photoDiff,
    ).toBeGreaterThan(1000);

    expect(errors).toEqual([]);
  });

  test('自由旋转保留用户拖动的视角', async ({ page }) => {
    const errors = watchPageErrors(page);
    await page.goto('/?prologue=skip');
    await fireToExhibition(page);

    const group = page.getByRole('group', { name: '推荐机位' });
    await group.getByRole('button', { name: '正视', exact: true }).click();
    await nextFrames(page);
    const front = await downloadPng(page);

    await group.getByRole('button', { name: '特写', exact: true }).click();
    await nextFrames(page);
    const closeup = await downloadPng(page);
    // The close-up really did move the camera.
    expect(
      (await compareExports(page, front, closeup)).photoDiff,
    ).toBeGreaterThan(1000);

    // Picking 自由旋转 must not snap the camera back to a canonical pose:
    // the photo still has to be the close-up the user was looking at.
    await group.getByRole('button', { name: '自由旋转', exact: true }).click();
    await nextFrames(page);
    const free = await downloadPng(page);
    expect(free.equals(closeup)).toBe(true);
    expect((await compareExports(page, closeup, free)).photoDiff).toBe(0);

    // Orbiting with 自由旋转 selected has to reach the exported picture.
    const canvas = page.getByLabel('三维陶器画布');
    const rect = (await canvas.boundingBox())!;
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      rect.x + rect.width / 2 + 160,
      rect.y + rect.height / 2 - 40,
      { steps: 12 },
    );
    await page.mouse.up();
    await nextFrames(page, 3);
    const dragged = await downloadPng(page);

    expect(dragged.equals(free)).toBe(false);
    const diff = await compareExports(page, free, dragged);
    expect(diff.photoDiff).toBeGreaterThan(1000);

    expect(errors).toEqual([]);
  });
});

test('三套展陈改变成品照片，收藏后重新打开可恢复', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = watchPageErrors(page);
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      message.text().includes('THREE.WebGLProgram')
    ) {
      errors.push(message.text());
    }
  });
  await page.goto('/?prologue=skip');
  await fireToExhibition(page);

  const scenes = page.getByRole('group', { name: '展陈场景' });
  const studio = scenes.getByRole('button', { name: '素色展台' });
  await expect(studio).toHaveAttribute('aria-pressed', 'true');

  const original = await downloadPng(page);
  const previousPhotos = [original];
  for (const name of ['云山留白', '木格暖阁', '月门夜庭']) {
    const scene = scenes.getByRole('button', { name });
    await scene.click();
    await expect(scene).toHaveAttribute('aria-pressed', 'true');
    const photo = await downloadPng(page);
    expect(photo.readUInt32BE(16)).toBe(1080);
    expect(photo.readUInt32BE(20)).toBe(1080);
    for (const previous of previousPhotos) {
      const diff = await compareExports(page, previous, photo);
      expect(diff.photoDiff).toBeGreaterThan(100_000);
      expect(diff.bandDiff).toBe(0);
    }
    previousPhotos.push(photo);
  }

  await page.getByRole('button', { name: '保存到藏品' }).click();
  await expect(page.getByRole('status')).toContainText('作品已保存');
  await page.reload();
  page.on('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: '打开作品' }).click();
  await expect(
    scenes.getByRole('button', { name: '月门夜庭' }),
  ).toHaveAttribute('aria-pressed', 'true');
  expect(
    (await compareExports(page, previousPhotos[3], await downloadPng(page)))
      .photoDiff,
  ).toBe(0);

  await studio.click();
  expect(
    (await compareExports(page, original, await downloadPng(page))).photoDiff,
  ).toBe(0);
  await page.getByRole('button', { name: '继续彩绘' }).click();
  await expect(scenes).toHaveCount(0);
  expect(errors).toEqual([]);
});

test.describe('创作闭环', () => {
  test('导出后可以继续彩绘，并再次烧制到成品', async ({ page }) => {
    const errors = watchPageErrors(page);
    await page.goto('/?prologue=skip');
    await page.getByRole('button', { name: '定型进入彩绘' }).click();

    // One stroke, so the undo history survives the round trip.
    const canvas = page.getByLabel('三维陶器画布');
    const rect = (await canvas.boundingBox())!;
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height * 0.52);
    await page.mouse.down();
    await page.mouse.move(
      rect.x + rect.width / 2 + 20,
      rect.y + rect.height * 0.48,
      { steps: 8 },
    );
    await page.mouse.up();
    await expect(page.getByText('已落笔 1 次', { exact: false })).toBeVisible();

    await page.getByRole('button', { name: '入窑烧制' }).click();
    await expect(page.getByLabel('作品名称')).toBeVisible();
    await page.getByLabel('作品名称').fill('二轮青花瓶');
    await downloadPng(page);

    // Continuing to paint brings the painting stage back with its history.
    await page.getByRole('button', { name: '继续彩绘' }).click();
    await expect(
      page.getByRole('button', { name: '撤销', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: '重做', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('已落笔 1 次', { exact: false })).toBeVisible();
    await expect(
      page.getByRole('button', { name: '撤销', exact: true }),
    ).toBeEnabled();

    // The second firing runs to the end as well.
    await page.getByRole('button', { name: '入窑烧制' }).click();
    const progress = page.getByRole('progressbar', { name: '烧制进度' });
    await expect(progress).toBeVisible();
    await expect(page.getByLabel('作品名称')).toHaveCount(0);
    await expect(page.getByLabel('作品名称')).toBeVisible();
    await expect(progress).toHaveCount(0);
    await expect(
      page.locator('nav[aria-label="制作阶段"] span[aria-current="step"]'),
    ).toContainText('成品');

    expect(errors).toEqual([]);
  });

  test('釉面在烧制过程中连续过渡，而不是一次性跳变', async ({ page }) => {
    const errors = watchPageErrors(page);
    await page.goto('/?prologue=skip');
    await page.getByRole('button', { name: '定型进入彩绘' }).click();

    // Sample the vessel centre once per animation frame while the kiln runs.
    // The renderer does not preserve its drawing buffer, so the read has to
    // happen inside a requestAnimationFrame callback, right after the frame
    // was drawn; a detached buffer would read as fully transparent.
    await page.evaluate(() => {
      const store = window as unknown as {
        samples: { progress: string | null; rgb: number[]; alpha: number }[];
      };
      store.samples = [];
      const canvas = document.querySelector('canvas');
      if (!canvas) throw new Error('canvas missing');
      const gl = canvas.getContext('webgl2');
      if (!gl) throw new Error('webgl2 context missing');
      const pixel = new Uint8Array(4);
      const tick = () => {
        const bar = document.querySelector('[role="progressbar"]');
        gl.readPixels(
          Math.floor(canvas.width / 2),
          Math.floor(canvas.height / 2),
          1,
          1,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          pixel,
        );
        store.samples.push({
          progress: bar ? bar.getAttribute('aria-valuenow') : null,
          rgb: [pixel[0], pixel[1], pixel[2]],
          alpha: pixel[3],
        });
        if (store.samples.length < 600) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    await page.getByRole('button', { name: '入窑烧制' }).click();
    await expect(page.getByLabel('作品名称')).toBeVisible();
    await page.waitForTimeout(300);

    const samples = await page.evaluate(() => {
      const store = window as unknown as {
        samples: { progress: string | null; rgb: number[]; alpha: number }[];
      };
      return store.samples;
    });
    const firing = samples.filter(
      (sample) => sample.progress !== null && sample.alpha > 0,
    );
    expect(firing.length).toBeGreaterThanOrEqual(3);

    const step = (a: number[], b: number[]) =>
      Math.max(
        Math.abs(a[0] - b[0]),
        Math.abs(a[1] - b[1]),
        Math.abs(a[2] - b[2]),
      );
    const luminance = (colour: number[]) =>
      0.299 * colour[0] + 0.587 * colour[1] + 0.114 * colour[2];
    const first = firing[0].rgb;
    const last = firing[firing.length - 1].rgb;
    const total = step(first, last);

    // The material really changed over the firing ...
    expect(total).toBeGreaterThan(20);
    // ... but it stayed a ceramic surface, it did not flash into a wild
    // colour: bisque (216, 194, 160) turns into white glaze (255, 255, 250).
    expect(total).toBeLessThan(120);

    // The glaze is not just a brighter bisque: the warm bisque tint (the
    // #d5c8b6 body colour) has to disappear under the white glaze, so the
    // red-blue gap collapses from ~56 to ~5.
    const warmth = (colour: number[]) => colour[0] - colour[2];
    expect(warmth(first)).toBeGreaterThan(40);
    expect(warmth(last)).toBeLessThan(20);

    // The decisive evidence that the material changes *over time* and not in
    // one jump: while the kiln has barely progressed (up to 20 %) the vessel
    // must still be almost entirely bisque. A material that snapped to its
    // final glaze on the first frame would already have lost about half of
    // its warmth by then.
    const early = firing.filter((sample) => Number(sample.progress) <= 20);
    expect(early.length).toBeGreaterThan(0);
    const warmthSpan = warmth(first) - warmth(last);
    for (const sample of early) {
      const spent = (warmth(first) - warmth(sample.rgb)) / warmthSpan;
      expect(spent).toBeLessThan(0.3);
    }

    // The transition is continuous: the pot passed through intermediate
    // shades instead of jumping straight from bisque to glaze in one frame.
    const distinct = new Set(firing.map((sample) => sample.rgb.join(',')));
    expect(distinct.size).toBeGreaterThanOrEqual(3);
    const interior = firing.filter(
      (sample) =>
        Number(sample.progress) > 0 &&
        Number(sample.progress) < 100 &&
        step(first, sample.rgb) > 0 &&
        step(first, sample.rgb) < total,
    );
    expect(interior.length).toBeGreaterThanOrEqual(1);

    // And it brightened the whole way, without flickering back and forth.
    // The comparison is made three samples apart on purpose: the probe's
    // requestAnimationFrame and the renderer's are not ordered against each
    // other, so one sample can read a value that is one frame stale. A dip
    // that lasts a single frame is sampling noise; a real flicker lasts
    // longer than that and still trips this check.
    for (let i = 3; i < firing.length; i += 1) {
      expect(luminance(firing[i].rgb)).toBeGreaterThanOrEqual(
        luminance(firing[i - 3].rgb) - 1,
      );
    }

    expect(errors).toEqual([]);
  });

  test('卷轴序幕、彩绘毛笔水晕与成品阶段小金属棒五声轻叩听音', async ({
    page,
  }) => {
    const errors = watchPageErrors(page);
    // No query parameter: this is the path a first-time visitor gets.
    await page.goto('/');

    // Scroll prologue is visible on entry and opens when clicking 入坊造物
    const enterBtn = page.getByRole('button', { name: '入坊造物' });
    await expect(enterBtn).toBeVisible();
    await enterBtn.click();
    await expect(page.locator('.scroll-prologue.is-open')).toHaveCount(1);

    // Painting stage shows the miniature calligraphy brush reticle
    await page.getByRole('button', { name: '定型进入彩绘' }).click();
    const canvas = page.getByLabel('三维陶器画布');
    const rect = (await canvas.boundingBox())!;
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await expect(canvas).toHaveAttribute('data-cursor', 'brush-reticle');
    await expect(page.locator('.calligraphy-brush-reticle')).toHaveCount(1);

    // Importing an image extracts its contours and imprints onto the vessel
    const sampleSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#fff"/><circle cx="40" cy="40" r="24" fill="#000"/></svg>`;
    await page.getByLabel('导入图案图片').setInputFiles({
      name: 'motif.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(sampleSvg, 'utf-8'),
    });
    await expect(page.getByLabel('导入图案青花轮廓预览')).toBeVisible();
    await expect(
      page.getByRole('button', { name: '导入图样' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('已落笔 1 次', { exact: false })).toBeVisible();

    await page.getByRole('button', { name: '入窑烧制' }).click();
    await expect(page.getByRole('heading', { name: '成品工作台' })).toBeVisible(
      { timeout: 10_000 },
    );

    // Hovering over the center of the finished porcelain switches to the metal rod cursor
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await expect(canvas).toHaveAttribute('data-cursor', 'metal-rod');

    // Clicking on the porcelain strikes one pentatonic note and spawns an upward-floating note glyph
    await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await expect(canvas).toHaveAttribute('data-cursor', 'metal-rod');
    await expect(page.locator('.chime-note-glyph')).toHaveCount(1);
    await expect(page.locator('.scene-hint')).toContainText('轻叩瓷身奏响五声');

    // Moving to the far corner outside the vessel clears the metal rod cursor
    await page.mouse.move(rect.x + 12, rect.y + 12);
    await expect(canvas).not.toHaveAttribute('data-cursor', 'metal-rod');

    expect(errors).toEqual([]);
  });
});

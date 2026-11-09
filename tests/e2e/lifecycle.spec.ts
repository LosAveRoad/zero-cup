import { expect, test } from '@playwright/test';

interface ResourceReading {
  raf: number;
  buffers: number;
  textures: number;
  createdBuffers: number;
  deletedBuffers: number;
}

declare global {
  interface Window {
    __studioResources: () => ResourceReading;
  }
}

// Runs before application modules. Count actual GPU handles, not Three objects
// that can remain allocated in JS after their GPU storage has been disposed.
function installResourceProbe() {
  const pending = new Set<number>();
  const request = window.requestAnimationFrame.bind(window);
  const cancel = window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) => {
    const id = request((time) => {
      pending.delete(id);
      callback(time);
    });
    pending.add(id);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    pending.delete(id);
    cancel(id);
  };

  const buffers = new Set<WebGLBuffer>();
  const textures = new Set<WebGLTexture>();
  let createdBuffers = 0;
  let deletedBuffers = 0;
  for (const prototype of [
    WebGLRenderingContext.prototype,
    WebGL2RenderingContext.prototype,
  ]) {
    const createBuffer = prototype.createBuffer;
    const deleteBuffer = prototype.deleteBuffer;
    const createTexture = prototype.createTexture;
    const deleteTexture = prototype.deleteTexture;
    prototype.createBuffer = function () {
      const buffer = createBuffer.call(this);
      if (buffer) {
        buffers.add(buffer);
        createdBuffers++;
      }
      return buffer;
    };
    prototype.deleteBuffer = function (buffer) {
      if (buffer && buffers.delete(buffer)) deletedBuffers++;
      return deleteBuffer.call(this, buffer);
    };
    prototype.createTexture = function () {
      const texture = createTexture.call(this);
      if (texture) textures.add(texture);
      return texture;
    };
    prototype.deleteTexture = function (texture) {
      if (texture) textures.delete(texture);
      return deleteTexture.call(this, texture);
    };
  }
  window.__studioResources = () => ({
    raf: pending.size,
    buffers: buffers.size,
    textures: textures.size,
    createdBuffers,
    deletedBuffers,
  });
}

test('20 new/open cycles keep RAF, GPU resources and DOM listeners bounded', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(installResourceProbe);
  await page.goto('/?prologue=skip');
  await expect(page.getByLabel('三维陶器画布')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  page.on('dialog', (dialog) => void dialog.accept());
  await page.getByLabel('截面 4 半径').fill('0.64');
  await page.getByRole('button', { name: '定型进入彩绘' }).click();
  const draw = async () => {
    const rect = (await page.getByLabel('三维陶器画布').boundingBox())!;
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height * 0.52);
    await page.mouse.down();
    await page.mouse.move(
      rect.x + rect.width / 2 + 20,
      rect.y + rect.height * 0.48,
      { steps: 4 },
    );
    await page.mouse.up();
    await expect(page.getByText('已落笔 1 次', { exact: false })).toBeVisible();
  };
  await draw();
  await page.getByRole('button', { name: '入窑烧制' }).click();
  await expect(page.getByRole('button', { name: '保存到藏品' })).toBeVisible();
  await page.getByLabel('作品名称').fill('资源循环基准');
  await page.getByRole('button', { name: '保存到藏品' }).click();
  await expect(page.getByRole('status')).toContainText('作品已保存');
  await page.getByRole('button', { name: '继续彩绘' }).click();

  const session = await page.context().newCDPSession(page);
  const resources = () => page.evaluate(() => window.__studioResources());
  const settle = async () => {
    // Observe completed frames; do not use a wall-clock sleep.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  };
  await settle();
  const baseline = await resources();
  expect(baseline.raf).toBe(1);
  expect(baseline.buffers).toBeGreaterThan(0);
  expect(baseline.textures).toBeGreaterThan(0);

  // Positive control: ensure the probe detects a leaked handle/pending frame.
  const control = await page.evaluate(() => {
    const canvas = document.querySelector(
      'canvas[aria-label="三维陶器画布"]',
    ) as HTMLCanvasElement;
    const gl = canvas.getContext('webgl2')!;
    const buffer = gl.createBuffer();
    const texture = gl.createTexture();
    const raf = requestAnimationFrame(() => {});
    const allocated = window.__studioResources();
    gl.deleteBuffer(buffer);
    gl.deleteTexture(texture);
    cancelAnimationFrame(raf);
    return { allocated, released: window.__studioResources() };
  });
  expect(control.allocated.buffers).toBe(baseline.buffers + 1);
  expect(control.allocated.textures).toBe(baseline.textures + 1);
  expect(control.allocated.raf).toBe(baseline.raf + 1);
  expect(control.released.buffers).toBe(baseline.buffers);
  expect(control.released.textures).toBe(baseline.textures);
  expect(control.released.raf).toBe(baseline.raf);
  await session.send('HeapProfiler.collectGarbage');
  const domBaseline = await session.send('Memory.getDOMCounters');
  const samples = [];
  for (let cycle = 1; cycle <= 20; cycle++) {
    await page.getByRole('button', { name: '新建作品', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('新作品已准备好。');
    await page.getByLabel('截面 4 半径').fill(String(0.5 + (cycle % 3) * 0.1));
    await page.getByRole('button', { name: '定型进入彩绘' }).click();
    await expect(page.getByText('已落笔 0 次', { exact: false })).toBeVisible();
    await draw();
    await page.getByRole('button', { name: '打开作品' }).click();
    await expect(page.getByLabel('作品名称')).toHaveValue('资源循环基准');
    await page.getByRole('button', { name: '继续彩绘' }).click();
    await expect(page.getByText('已落笔 1 次', { exact: false })).toBeVisible();
    await settle();
    const reading = await resources();
    expect(reading.raf, `cycle ${cycle}: pending RAF`).toBe(baseline.raf);
    expect(reading.buffers, `cycle ${cycle}: GPU buffers`).toBe(
      baseline.buffers,
    );
    expect(reading.textures, `cycle ${cycle}: GPU textures`).toBe(
      baseline.textures,
    );
    await expect(page.getByLabel('三维陶器画布')).toHaveCount(1);
    if (cycle % 5 === 0) {
      await session.send('HeapProfiler.collectGarbage');
      const dom = await session.send('Memory.getDOMCounters');
      expect(
        dom.jsEventListeners,
        `cycle ${cycle}: listeners`,
      ).toBeLessThanOrEqual(domBaseline.jsEventListeners);
      expect(
        dom.nodes,
        `cycle ${cycle}: retained DOM nodes`,
      ).toBeLessThanOrEqual(domBaseline.nodes);
      samples.push({ cycle, ...reading, ...dom });
    }
  }
  const final = await resources();
  expect(final.createdBuffers).toBeGreaterThan(baseline.createdBuffers);
  expect(final.deletedBuffers).toBeGreaterThan(baseline.deletedBuffers);
  expect(errors).toEqual([]);
  await testInfo.attach('resource-trend', {
    body: JSON.stringify({ baseline, domBaseline, samples }, null, 2),
    contentType: 'application/json',
  });
  await session.detach();
});

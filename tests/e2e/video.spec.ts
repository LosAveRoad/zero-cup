import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('展陈短片可取消重试，导出后可播放且可继续导出 PNG', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/?prologue=skip');
  await page.getByRole('button', { name: '定型进入彩绘' }).click();
  await page.getByRole('button', { name: /缠枝宝相莲/ }).click();
  await page.getByRole('button', { name: '入窑烧制' }).click();
  const generate = page.getByRole('button', { name: '生成演示视频' });
  await expect(generate).toBeVisible({ timeout: 12_000 });
  await page.getByRole('button', { name: '月门夜庭' }).click();

  await generate.click();
  await expect(
    page.getByRole('progressbar', { name: '视频生成进度' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '取消生成' }).click();
  await expect(page.getByRole('status')).toContainText('已取消视频生成');

  const videoDownload = page.waitForEvent('download');
  await generate.click();
  const movie = await videoDownload;
  expect(await movie.failure()).toBeNull();
  expect(movie.suggestedFilename()).toMatch(/\.(mp4|webm)$/);
  const bytes = await readFile((await movie.path())!);
  expect(bytes.length).toBeGreaterThan(50_000);

  const result = await page.evaluate(
    async ({ payload, type }) => {
      const url = URL.createObjectURL(
        new Blob(
          [Uint8Array.from(atob(payload), (char) => char.charCodeAt(0))],
          { type },
        ),
      );
      const video = document.createElement('video');
      video.muted = true;
      const canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 18;
      const ctx = canvas.getContext('2d')!;
      const samples: number[][] = [];
      let captionPixels = 0;
      function waitForFrame(event: 'loadeddata' | 'seeked') {
        return new Promise<void>((resolve, reject) => {
          video.addEventListener(event, () => resolve(), { once: true });
          video.onerror = () => reject(new Error('导出视频无法解码'));
        });
      }

      try {
        const loaded = waitForFrame('loadeddata');
        video.src = url;
        await loaded;
        await video.play();
        video.pause();
        for (const timestamp of [1, 4.6, 7.4, 10.8]) {
          const seeked = waitForFrame('seeked');
          video.currentTime = timestamp;
          await seeked;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          samples.push([...ctx.getImageData(0, 0, 32, 18).data]);
          if (samples.length === 1) {
            ctx.drawImage(video, 520, 614, 240, 46, 0, 0, 32, 18);
            captionPixels = ctx
              .getImageData(0, 0, 32, 18)
              .data.filter((value, i) => i % 4 === 0 && value > 140).length;
          }
        }
        return {
          width: video.videoWidth,
          height: video.videoHeight,
          endTime: video.currentTime,
          captionPixels,
          samples,
        };
      } finally {
        video.pause();
        URL.revokeObjectURL(url);
      }
    },
    {
      payload: bytes.toString('base64'),
      type: movie.suggestedFilename().endsWith('.mp4')
        ? 'video/mp4'
        : 'video/webm',
    },
  );
  expect([result.width, result.height]).toEqual([1280, 720]);
  expect(result.endTime).toBeGreaterThanOrEqual(10.7);
  expect(result.samples).toHaveLength(4);
  // The first frame's selected backdrop is dark blue, with a bright subtitle
  // in the lower safe area above the trim line.
  const skyIndex = (3 * 32 + 28) * 4;
  const opening = result.samples[0];
  expect(opening[skyIndex]).toBeLessThan(80);
  expect(opening[skyIndex + 2] - opening[skyIndex]).toBeGreaterThan(12);
  expect(result.captionPixels).toBeGreaterThan(10);
  for (let i = 1; i < result.samples.length; i++) {
    const previous = result.samples[i - 1];
    const difference = result.samples[i].reduce(
      (sum, value, index) => sum + Math.abs(value - previous[index]),
      0,
    );
    expect(difference).toBeGreaterThan(6_000);
  }
  const outro = result.samples[3];
  const sealPixels = outro.filter(
    (value, i) => i % 4 === 0 && value > 105 && value > 1.8 * outro[i + 1],
  );
  expect(sealPixels.length).toBeGreaterThan(0);

  const imageDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载 PNG' }).click();
  const png = await readFile((await (await imageDownload).path())!);
  expect(png.readUInt32BE(16)).toBe(1080);
  expect(png.readUInt32BE(20)).toBe(1080);
  expect(errors).toEqual([]);
});

import { expect, test } from '@playwright/test';
test('shape, draw, fire, download, save, reload and reopen a real artwork', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?prologue=skip');
  await expect(
    page.getByRole('heading', { name: '瓷器物语', exact: true }),
  ).toBeVisible();
  const canvas = page.getByLabel('三维陶器画布');
  await expect(canvas).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  const radius = page.getByLabel('截面 4 半径');
  await radius.fill('0.72');
  await expect(radius).toHaveValue('0.72');
  await page.getByRole('button', { name: '定型进入彩绘' }).click();
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
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByText('已落笔 0 次', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await page.getByRole('button', { name: '入窑烧制' }).click();
  await expect(page.getByText('窑火正盛')).toBeVisible();
  await page.getByLabel('作品名称').fill('端到端青花瓶');
  await page.screenshot({
    path: 'test-results/studio-baseline.png',
    fullPage: true,
  });
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载 PNG' }).click();
  const download = await downloadEvent;
  expect(await download.failure()).toBeNull();
  const imageBytes = await (
    await import('node:fs/promises')
  ).readFile((await download.path())!);
  expect(imageBytes.readUInt32BE(16)).toBe(1080);
  expect(imageBytes.readUInt32BE(20)).toBe(1080);
  expect(imageBytes.length).toBeGreaterThan(10000);
  await page.getByRole('button', { name: '保存到藏品' }).click();
  await expect(
    page.getByRole('heading', { name: '端到端青花瓶' }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: '端到端青花瓶' }),
  ).toBeVisible();
  page.on('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: '打开作品' }).click();
  await expect(page.getByLabel('作品名称')).toHaveValue('端到端青花瓶');
  await page.getByRole('button', { name: '继续彩绘' }).click();
  await expect(page.getByText('已落笔 1 次', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '入窑烧制' }).click();
  await expect(page.getByRole('button', { name: '打开作品' })).toBeDisabled();
  await expect(page.getByLabel('作品名称')).toBeVisible();
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('作品已删除。');
  await page.reload();
  await expect(page.getByRole('heading', { name: '端到端青花瓶' })).toHaveCount(
    0,
  );
  expect(errors).toEqual([]);
});

import { expect, test } from '@playwright/test';

test('opening page offers free creation and an encyclopedia of vessel goals', async ({
  page,
}) => {
  await page.goto('/');
  const opening = page.locator('.scroll-card');

  await expect(
    opening.getByRole('button', { name: '自由创作', exact: true }),
  ).toBeVisible();
  await opening.getByRole('button', { name: /器型百科/ }).click();

  const panel = page.getByRole('dialog', { name: '器型百科' });
  await expect(panel.getByText('玉壶春瓶', { exact: true })).toBeVisible();
  await expect(panel.getByText('梅瓶', { exact: true })).toBeVisible();
  await expect(panel.getByText('压手杯', { exact: true })).toBeVisible();
  await expect(
    panel.getByRole('button', { name: '阅读百科：梅瓶' }),
  ).toBeVisible();
  await expect(
    panel.getByRole('button', { name: '选择创作：梅瓶' }),
  ).toBeVisible();

  await panel.getByRole('button', { name: '关闭器型百科' }).click();
  await opening.getByRole('button', { name: '自由创作', exact: true }).click();

  await expect(page.locator('.scroll-prologue.is-open')).toHaveCount(1);
  await expect(page.locator('.sliders')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: '拉坯工作台', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText('拖动二维轮廓点塑形，或用滑块微调半径。', { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText('拖动二维轮廓点，开始塑造你的器型。', { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: '器型百科' })).toBeVisible();
});

test('the encyclopedia uses fixed text and museum images and opens the selected vessel', async ({
  page,
}) => {
  const researchApiRequests: string[] = [];
  page.on('request', (request) => {
    if (
      /zh\.wikipedia\.org\/w\/api\.php|collectionapi\.metmuseum\.org/.test(
        request.url(),
      )
    ) {
      researchApiRequests.push(request.url());
    }
  });
  await page.goto('/');

  await page
    .locator('.scroll-card')
    .getByRole('button', { name: /器型百科/ })
    .click();

  const panel = page.getByRole('dialog', { name: '器型百科' });
  await panel.getByRole('button', { name: '阅读百科：玉壶春瓶' }).click();
  const yuhuchunImage = panel.getByRole('img', { name: '青花缠枝莲纹瓶' });
  await expect(yuhuchunImage).toBeVisible();
  await expect(yuhuchunImage).toHaveAttribute(
    'src',
    '/images/encyclopedia/yuhuchun.jpg',
  );
  await expect
    .poll(() =>
      yuhuchunImage.evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0);
  await panel.getByRole('button', { name: '返回器型目录' }).click();
  await panel.getByRole('button', { name: '阅读百科：梅瓶' }).click();

  await expect(
    panel.getByRole('button', { name: '以梅瓶为目标创作' }),
  ).toBeVisible();
  await expect(panel.getByText(/梅瓶，也稱經瓶/)).toBeVisible();
  await expect(panel.getByRole('link', { name: /维基百科/ })).toHaveCount(0);
  await expect(panel.getByText(/CC BY-SA|CC0/)).toHaveCount(0);
  await expect(
    panel.getByRole('img', { name: '青花桃石榴佛手纹梅瓶' }),
  ).toBeVisible();
  await expect(
    panel.getByRole('link', {
      name: '青花桃石榴佛手纹梅瓶',
      exact: true,
    }),
  ).toHaveAttribute(
    'href',
    'https://www.metmuseum.org/art/collection/search/47621',
  );
  await expect(
    panel.getByRole('img', { name: '青花桃石榴佛手纹梅瓶' }),
  ).toHaveAttribute('src', '/images/encyclopedia/meiping.jpg');
  await expect
    .poll(() =>
      panel
        .getByRole('img', { name: '青花桃石榴佛手纹梅瓶' })
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0);

  await panel.getByRole('button', { name: '以梅瓶为目标创作' }).click();
  await expect(page.locator('.scroll-prologue.is-open')).toHaveCount(1);
  const wikiButton = page.getByRole('button', {
    name: '器型百科',
    exact: true,
  });
  await expect(wikiButton).toBeVisible();
  await wikiButton.click();
  await page.getByRole('button', { name: '定型进入彩绘' }).click();
  await expect(panel).toBeVisible();
  await expect(wikiButton).toBeVisible();
  await expect(
    panel.getByRole('heading', { name: '梅瓶 · 器型百科' }),
  ).toBeVisible();
  await expect(
    panel.getByRole('button', { name: '选择创作：自由创作' }),
  ).toHaveCount(0);
  expect(researchApiRequests).toEqual([]);
});

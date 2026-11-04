import { expect, test } from '@playwright/test';
test('application shell loads without uncaught errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: '瓷器物语', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('status')).toContainText('创作功能开发中');
  expect(errors).toEqual([]);
});

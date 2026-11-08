import { expect, test, type Page } from '@playwright/test';

const MIN_RADIUS = 0.08;
const MAX_RADIUS = 0.9;
const MIN_HEIGHT = 0;
const MAX_HEIGHT = 1;
const SPLINE_SEGMENTS = 64;
const DEFAULT_RADII = [0.35, 0.48, 0.57, 0.6, 0.53, 0.36, 0.25, 0.3];

interface ControlPoint {
  id: string;
  radius: number;
  height: number;
  cx: number;
  cy: number;
}

interface CanvasSample {
  x: number;
  y: number;
}

/**
 * Counts the pixels of the vessel (and its pedestal) in the WebGL canvas.
 *
 * The renderer runs without `preserveDrawingBuffer`, so the canvas can only
 * be read inside a requestAnimationFrame callback, after it has drawn a
 * frame. The stage background is a flat #e9e6de; the vessel is clearly
 * different from it.
 */
async function vesselPixels(page: Page): Promise<number> {
  return await page.evaluate(
    () =>
      new Promise((resolve) => {
        let frames = 0;
        const tick = () => {
          if (++frames < 8) {
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
          const { data } = ctx.getImageData(0, 0, el.width, el.height);
          let count = 0;
          for (let i = 0; i < data.length; i += 4) {
            if (
              Math.abs(data[i] - 233) > 6 ||
              Math.abs(data[i + 1] - 230) > 6 ||
              Math.abs(data[i + 2] - 222) > 6
            )
              count += 1;
          }
          resolve(count);
        };
        requestAnimationFrame(tick);
      }),
  );
}

/** Every control point of the outline editor, read from the DOM. */
async function readControlPoints(page: Page): Promise<ControlPoint[]> {
  return page.$$eval('[data-testid^="profile-point-"]', (elements) =>
    elements.map((element) => ({
      id: element.getAttribute('data-testid') ?? '',
      radius: Number(element.getAttribute('data-radius')),
      height: Number(element.getAttribute('data-height')),
      cx: Number(element.getAttribute('cx')),
      cy: Number(element.getAttribute('cy')),
    })),
  );
}

/** The 65 sampled points of the drawn outline, in SVG user coordinates. */
async function readOutlineSamples(page: Page): Promise<CanvasSample[]> {
  const path = await page.getByTestId('profile-outline').getAttribute('d');
  const numbers = (path ?? '').match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  const samples: CanvasSample[] = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    samples.push({ x: numbers[i], y: numbers[i + 1] });
  }
  return samples;
}

/**
 * Centre of a control point on screen. The shaping sidebar scrolls, so it is
 * reset first: otherwise the sticky "定型进入彩绘" button can cover the point.
 */
async function controlPointCentre(
  page: Page,
  testId: string,
): Promise<{ x: number; y: number }> {
  await page.locator('aside').evaluate((element) => {
    element.scrollTop = 0;
  });
  const point = page.getByTestId(testId);
  await point.scrollIntoViewIfNeeded();
  const box = await point.boundingBox();
  if (!box) throw new Error(`control point ${testId} is not visible`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Drags a control point by a screen space offset. */
async function dragPointBy(
  page: Page,
  testId: string,
  dx: number,
  dy: number,
): Promise<void> {
  const { x, y } = await controlPointCentre(page, testId);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 12 });
  await page.mouse.up();
}

/** Drags a control point to an absolute screen position. */
async function dragPointTo(
  page: Page,
  testId: string,
  x: number,
  y: number,
): Promise<void> {
  const start = await controlPointCentre(page, testId);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 12 });
  await page.mouse.up();
}

/** Fritsch–Carlson tangents of the monotone cubic Hermite spline. */
function monotoneTangents(points: ControlPoint[]): number[] {
  const secants: number[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const span = points[i + 1].height - points[i].height;
    secants.push((points[i + 1].radius - points[i].radius) / span);
  }
  const tangents: number[] = [];
  for (let i = 0; i < points.length; i += 1) {
    if (i === 0) tangents[i] = secants[0];
    else if (i === points.length - 1) tangents[i] = secants[secants.length - 1];
    else tangents[i] = (secants[i - 1] + secants[i]) / 2;
  }
  for (let i = 0; i < points.length - 1; i += 1) {
    const delta = secants[i];
    if (delta === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
      continue;
    }
    let alpha = tangents[i] / delta;
    let beta = tangents[i + 1] / delta;
    if (alpha < 0) alpha = 0;
    if (beta < 0) beta = 0;
    const norm = alpha * alpha + beta * beta;
    if (norm > 9) {
      const tau = 3 / Math.sqrt(norm);
      alpha *= tau;
      beta *= tau;
    }
    tangents[i] = alpha * delta;
    tangents[i + 1] = beta * delta;
  }
  return tangents;
}

/** Radius of the monotone spline at an arbitrary height. */
function splineRadiusAt(
  points: ControlPoint[],
  tangents: number[],
  height: number,
): number {
  const last = points.length - 1;
  if (height <= points[0].height) return points[0].radius;
  if (height >= points[last].height) return points[last].radius;
  let i = 0;
  while (i < last - 1 && points[i + 1].height < height) i += 1;
  const a = points[i];
  const b = points[i + 1];
  const span = b.height - a.height;
  const t = (height - a.height) / span;
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return (
    h00 * a.radius +
    h10 * span * tangents[i] +
    h01 * b.radius +
    h11 * span * tangents[i + 1]
  );
}

/** The two control points that enclose a height. */
function bracketFor(
  points: ControlPoint[],
  height: number,
): [ControlPoint, ControlPoint] {
  let index = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    if (points[i].height <= height + 1e-9) index = i;
  }
  return [points[index], points[index + 1]];
}

/**
 * Maps a value (radius or height) onto its SVG coordinate. The editor draws
 * both axes linearly, so the two extreme control points define the mapping
 * exactly; the rest of the points are used to verify that assumption.
 */
function linearMap(
  values: number[],
  coordinates: number[],
): { slope: number; intercept: number } {
  const pairs = values
    .map((value, index) => ({ value, coordinate: coordinates[index] }))
    .sort((a, b) => a.value - b.value);
  const low = pairs[0];
  const high = pairs[pairs.length - 1];
  const slope = (high.coordinate - low.coordinate) / (high.value - low.value);
  return { slope, intercept: low.coordinate - slope * low.value };
}

/**
 * Asserts that the outline never leaves the bracket of the two control points
 * it interpolates:
 *
 * 1. the monotone cubic Hermite spline rebuilt from the control points, and
 * 2. the curve the editor actually draws, read back from the SVG outline.
 */
async function expectOutlineInsideNeighbourBracket(
  page: Page,
  points: ControlPoint[],
): Promise<void> {
  const tangents = monotoneTangents(points);
  for (let i = 0; i < points.length - 1; i += 1) {
    const low = Math.min(points[i].radius, points[i + 1].radius);
    const high = Math.max(points[i].radius, points[i + 1].radius);
    const span = points[i + 1].height - points[i].height;
    for (let step = 1; step < 10; step += 1) {
      const height = points[i].height + (span * step) / 10;
      const value = splineRadiusAt(points, tangents, height);
      expect(value).toBeGreaterThanOrEqual(low - 1e-9);
      expect(value).toBeLessThanOrEqual(high + 1e-9);
    }
  }

  // The editor maps radius and height linearly onto the SVG axes, so the
  // mapping is recovered from the control points themselves.
  const samples = await readOutlineSamples(page);
  expect(samples).toHaveLength(SPLINE_SEGMENTS + 1);
  const radiusMap = linearMap(
    points.map((point) => point.radius),
    points.map((point) => point.cx),
  );
  const heightMap = linearMap(
    points.map((point) => point.height),
    points.map((point) => point.cy),
  );
  for (const point of points) {
    expect(
      Math.abs(
        point.cx - (radiusMap.intercept + radiusMap.slope * point.radius),
      ),
    ).toBeLessThan(1e-6);
    expect(
      Math.abs(
        point.cy - (heightMap.intercept + heightMap.slope * point.height),
      ),
    ).toBeLessThan(1e-6);
  }
  for (const sample of samples) {
    const radius = (sample.x - radiusMap.intercept) / radiusMap.slope;
    const height = (sample.y - heightMap.intercept) / heightMap.slope;
    const [a, b] = bracketFor(points, height);
    const low = Math.min(a.radius, b.radius);
    const high = Math.max(a.radius, b.radius);
    expect(radius).toBeGreaterThanOrEqual(low - 1e-3);
    expect(radius).toBeLessThanOrEqual(high + 1e-3);
    expect(radius).toBeGreaterThanOrEqual(MIN_RADIUS - 1e-3);
    expect(radius).toBeLessThanOrEqual(MAX_RADIUS + 1e-3);
  }
}

/** Distinct colours of the 3D canvas, to prove the vessel is still drawn. */
async function readCanvasColours(
  page: Page,
): Promise<{ total: number; corner: number }> {
  return await page.evaluate(
    () =>
      new Promise((resolve) => {
        let frames = 0;
        const tick = () => {
          if (++frames < 8) {
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
          const count = (
            x: number,
            y: number,
            width: number,
            height: number,
          ) => {
            const { data } = ctx.getImageData(x, y, width, height);
            const seen = new Set<number>();
            for (let i = 0; i < data.length; i += 4) {
              seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
            }
            return seen.size;
          };
          resolve({
            total: count(0, 0, copy.width, copy.height),
            corner: count(0, 0, 40, 40),
          });
        };
        requestAnimationFrame(tick);
      }),
  );
}

test.describe('outline editor: dragging control points', () => {
  test('dragging a control point changes the outline and the model', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');

    const point = page.getByTestId('profile-point-3');
    await expect(point).toHaveAttribute('aria-label', '控制点 4');
    await expect(point).toHaveAttribute('role', 'slider');
    const radiusBefore = await point.getAttribute('data-radius');
    const heightBefore = await point.getAttribute('data-height');
    const outlineBefore = await page
      .getByTestId('profile-outline')
      .getAttribute('d');
    // Wait until the scene has actually been drawn, so the baseline below is
    // the vessel and not an empty canvas.
    await expect.poll(() => vesselPixels(page)).toBeGreaterThan(0);
    const vesselBefore = await vesselPixels(page);

    await dragPointBy(page, 'profile-point-3', 30, -12);

    await expect(point).not.toHaveAttribute('data-radius', radiusBefore ?? '');
    await expect(point).not.toHaveAttribute('data-height', heightBefore ?? '');
    const radius = Number(await point.getAttribute('data-radius'));
    const height = Number(await point.getAttribute('data-height'));
    expect(radius).toBeGreaterThanOrEqual(MIN_RADIUS);
    expect(radius).toBeLessThanOrEqual(MAX_RADIUS);
    expect(height).toBeGreaterThanOrEqual(MIN_HEIGHT);
    expect(height).toBeLessThanOrEqual(MAX_HEIGHT);
    // The point followed the pointer: right grows the radius, up the height.
    expect(radius).toBeGreaterThan(Number(radiusBefore));
    expect(height).toBeGreaterThan(Number(heightBefore));

    // The drawn outline follows the control point.
    await expect(page.getByTestId('profile-outline')).not.toHaveAttribute(
      'd',
      outlineBefore ?? '',
    );
    expect(await readOutlineSamples(page)).toHaveLength(SPLINE_SEGMENTS + 1);

    // The 3D model is rebuilt from the new profile: the vessel gets wider, so
    // it covers more pixels. (An element screenshot of the WebGL canvas is
    // not used here: on a software-rendered CI runner it can come back
    // byte-identical even though the scene changed.)
    await expect
      .poll(() => vesselPixels(page), { timeout: 15_000 })
      .toBeGreaterThan(vesselBefore);
    expect(await page.getByRole('alert').count()).toBe(0);
    expect(errors).toEqual([]);
  });

  test('a drag far beyond the canvas edge stays inside the legal range', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');

    const editor = await page
      .locator('svg[aria-label="器型轮廓编辑器"]')
      .boundingBox();
    expect(editor).not.toBeNull();
    const box = editor!;

    await dragPointTo(
      page,
      'profile-point-3',
      box.x + box.width + 400,
      box.y + box.height + 120,
    );

    const point = page.getByTestId('profile-point-3');
    const radius = Number(await point.getAttribute('data-radius'));
    const height = Number(await point.getAttribute('data-height'));
    expect(radius).toBeGreaterThanOrEqual(MIN_RADIUS);
    expect(radius).toBeLessThanOrEqual(MAX_RADIUS);
    expect(height).toBeGreaterThanOrEqual(MIN_HEIGHT);
    expect(height).toBeLessThanOrEqual(MAX_HEIGHT);
    // The drag ran far past the canvas, so the radius has to sit on the limit.
    expect(radius).toBe(MAX_RADIUS);

    // The profile is still a valid outline and the scene keeps rendering.
    expect(await readOutlineSamples(page)).toHaveLength(SPLINE_SEGMENTS + 1);
    expect(await page.getByRole('alert').count()).toBe(0);
    expect(errors).toEqual([]);
  });

  test('the first and the last control point stay pinned to height 0 and 1', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');

    const first = page.getByTestId('profile-point-0');
    const last = page.getByTestId('profile-point-7');
    const firstRadiusBefore = Number(await first.getAttribute('data-radius'));
    const lastRadiusBefore = Number(await last.getAttribute('data-radius'));

    // The foot is dragged up, the rim down: both drags pull the endpoint away
    // from its height, so only the pin can keep it there.
    await dragPointBy(page, 'profile-point-0', 30, -30);
    await expect(first).toHaveAttribute('data-height', '0');

    await dragPointBy(page, 'profile-point-7', 30, 30);
    await expect(last).toHaveAttribute('data-height', '1');

    // Both endpoints really moved, they only kept their height.
    const firstRadius = Number(await first.getAttribute('data-radius'));
    const lastRadius = Number(await last.getAttribute('data-radius'));
    expect(firstRadius).toBeGreaterThan(firstRadiusBefore);
    expect(lastRadius).toBeGreaterThan(lastRadiusBefore);
    expect(firstRadius).toBeLessThanOrEqual(MAX_RADIUS);
    expect(lastRadius).toBeLessThanOrEqual(MAX_RADIUS);
    expect(await readOutlineSamples(page)).toHaveLength(SPLINE_SEGMENTS + 1);
    expect(errors).toEqual([]);
  });
});

test.describe('outline editor: templates, reset and radius sliders', () => {
  test('resetting the outline restores the default vessel shape', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');

    await dragPointBy(page, 'profile-point-3', 40, -20);
    await expect(page.getByTestId('profile-point-3')).not.toHaveAttribute(
      'data-radius',
      String(DEFAULT_RADII[3]),
    );

    await page.getByRole('button', { name: '重置轮廓' }).click();

    await expect
      .poll(async () =>
        (await readControlPoints(page)).map((point) => point.radius),
      )
      .toEqual(DEFAULT_RADII);
    expect(await page.getByLabel('器型模板').inputValue()).toBe('');
    expect(errors).toEqual([]);
  });

  test('choosing a template loads a different outline', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');

    const before = (await readControlPoints(page)).map((point) => point.radius);
    await page.getByLabel('器型模板').selectOption('cup');
    await expect(page.getByLabel('器型模板')).toHaveValue('cup');

    await expect
      .poll(async () =>
        (await readControlPoints(page)).map((point) => point.radius),
      )
      .not.toEqual(before);
    const after = (await readControlPoints(page)).map((point) => point.radius);
    for (const radius of after) {
      expect(radius).toBeGreaterThanOrEqual(MIN_RADIUS);
      expect(radius).toBeLessThanOrEqual(MAX_RADIUS);
    }
    // The template is a different silhouette, not the default bowl.
    expect(after[7]).toBeGreaterThan(before[7]);
    expect(await readOutlineSamples(page)).toHaveLength(SPLINE_SEGMENTS + 1);
    expect(errors).toEqual([]);
  });

  test('the radius sliders still drive the outline', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');

    const radius = page.getByLabel('截面 4 半径');
    await radius.fill('0.72');
    await expect(radius).toHaveValue('0.72');
    await expect(page.getByTestId('profile-point-3')).toHaveAttribute(
      'data-radius',
      '0.72',
    );
    expect(errors).toEqual([]);
  });
});

test.describe('outline editor: the monotone spline never overshoots', () => {
  test('the sampled outline stays inside the bracket of its neighbours', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');

    // A sharp peak next to a sharp valley: the case in which a naive cubic
    // spline would bulge outside the two radii it interpolates.
    await dragPointBy(page, 'profile-point-3', 140, -60);
    await dragPointBy(page, 'profile-point-4', -140, 60);

    const points = await readControlPoints(page);
    expect(points).toHaveLength(8);
    // The stress case really is in place: the widest radius sits directly
    // above the narrowest one, only a hair of height apart.
    expect(points[3].radius).toBe(MAX_RADIUS);
    expect(points[4].radius).toBe(MIN_RADIUS);
    expect(points[3].height).toBeLessThan(points[4].height);
    expect(points[4].height - points[3].height).toBeLessThan(0.1);
    for (const point of points) {
      expect(point.radius).toBeGreaterThanOrEqual(MIN_RADIUS);
      expect(point.radius).toBeLessThanOrEqual(MAX_RADIUS);
      expect(point.height).toBeGreaterThanOrEqual(MIN_HEIGHT);
      expect(point.height).toBeLessThanOrEqual(MAX_HEIGHT);
    }

    await expectOutlineInsideNeighbourBracket(page, points);

    // 3. The 3D vessel is still on screen.
    const colours = await readCanvasColours(page);
    expect(colours.total).toBeGreaterThan(100);
    expect(colours.corner).toBeLessThanOrEqual(8);
    expect(await page.getByRole('alert').count()).toBe(0);
    expect(errors).toEqual([]);
  });

  test('a steep profile built from the sliders stays inside the bracket', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');

    // A narrow neck that opens into the widest radius and drops straight to
    // the narrowest one: the sharpest turn the editor allows.
    await page.getByLabel('截面 3 半径').fill('0.5');
    await page.getByLabel('截面 4 半径').fill('0.9');
    await page.getByLabel('截面 5 半径').fill('0.08');

    const points = await readControlPoints(page);
    expect(points.map((point) => point.radius)).toEqual([
      0.35, 0.48, 0.5, 0.9, 0.08, 0.36, 0.25, 0.3,
    ]);

    await expectOutlineInsideNeighbourBracket(page, points);

    const colours = await readCanvasColours(page);
    expect(colours.total).toBeGreaterThan(100);
    expect(errors).toEqual([]);
  });
});

test.describe('vessel shape challenges', () => {
  test('a challenge scores the outline and the target shape scores 100', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');

    await page.getByRole('button', { name: '梅瓶', exact: true }).click();
    await expect(
      page.getByRole('button', { name: '梅瓶', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(
      page.getByRole('button', { name: '自由创作', exact: true }),
    ).toHaveAttribute('aria-pressed', 'false');
    await expect(
      page.getByRole('img', { name: '梅瓶 目标剪影' }),
    ).toBeVisible();

    const score = page.getByText(/吻合度 \d+%/);
    await expect(score).toHaveCount(1);
    const scoreText = (await score.textContent()) ?? '';
    const percentage = Number(/吻合度 (\d+)%/.exec(scoreText)?.[1]);
    expect(Number.isInteger(percentage)).toBe(true);
    expect(percentage).toBeGreaterThanOrEqual(0);
    expect(percentage).toBeLessThanOrEqual(100);
    await expect(
      page.getByRole('img', { name: /评分 [0-3] 星/ }),
    ).toBeVisible();

    const before = (await readControlPoints(page)).map((point) => point.radius);
    await page.getByRole('button', { name: '载入目标器型' }).click();

    // The outline becomes the 梅瓶 target shape.
    await expect
      .poll(async () =>
        (await readControlPoints(page)).map((point) => point.radius),
      )
      .toEqual([0.2, 0.3, 0.42, 0.54, 0.62, 0.56, 0.26, 0.15]);
    expect(before).not.toEqual([0.2, 0.3, 0.42, 0.54, 0.62, 0.56, 0.26, 0.15]);
    await expect(score).toContainText('吻合度 100%');
    expect(errors).toEqual([]);
  });

  test('free creation clears the challenge again', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');

    await page.getByRole('button', { name: '梅瓶', exact: true }).click();
    await expect(page.getByText(/吻合度 \d+%/)).toHaveCount(1);

    await page.getByRole('button', { name: '自由创作', exact: true }).click();

    await expect(page.getByText(/吻合度/)).toHaveCount(0);
    await expect(page.getByRole('img', { name: '梅瓶 目标剪影' })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole('button', { name: '自由创作', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(
      page.getByRole('button', { name: '梅瓶', exact: true }),
    ).toHaveAttribute('aria-pressed', 'false');
    expect(errors).toEqual([]);
  });
});

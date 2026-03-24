const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;

const artifactsDir = path.join(__dirname, "..", ".playwright-artifacts");

function ensureArtifactsDir() {
  fs.mkdirSync(artifactsDir, { recursive: true });
}

async function assertNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
}

test.beforeAll(() => {
  ensureArtifactsDir();
});

test("desktop layout and core content render correctly", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  await expect(page.locator("h1")).toContainText("Студия записи подкастов");
  await expect(page.locator('a[href="https://wa.me/79894590468"]').first()).toBeVisible();
  await expect(page.locator("#studio")).toBeVisible();
  await expect(page.locator("#formats")).toBeVisible();
  await expect(page.locator("#equipment")).toBeVisible();
  await expect(page.locator("#pricing")).toBeVisible();
  await expect(page.locator("#contacts")).toBeVisible();
  await expect(page.locator(".format-card")).toHaveCount(3);
  await expect(page.locator(".pricing-card")).toHaveCount(5);
  await expect(page.locator(".equipment-card")).toHaveCount(4);

  await assertNoHorizontalOverflow(page);
  await page.screenshot({
    path: path.join(artifactsDir, "desktop-full.png"),
    fullPage: true
  });
});

test("tablet menu works and layout stays stable", async ({ page }) => {
  await page.setViewportSize({ width: 834, height: 1194 });
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  const menuToggle = page.locator(".menu-toggle");
  await expect(menuToggle).toBeVisible();
  await menuToggle.click();
  await expect(page.locator(".mobile-menu.is-open")).toBeVisible();
  await expect(page.locator(".nav--mobile .nav__link")).toHaveCount(5);

  await page.screenshot({
    path: path.join(artifactsDir, "tablet-menu-open.png"),
    fullPage: true
  });

  await page.locator('.nav--mobile .nav__link[href="#pricing"]').click();
  await expect(page.locator("#pricing")).toBeInViewport();
  await assertNoHorizontalOverflow(page);
});

test("mobile layout keeps readable spacing and touch targets", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  await expect(page.locator(".hero__actions .btn").first()).toBeVisible();
  await expect(page.locator(".menu-toggle")).toBeVisible();

  const buttonHeights = await page.locator(".btn:visible").evaluateAll((nodes) =>
    nodes.map((node) => Math.round(node.getBoundingClientRect().height))
  );
  expect(Math.min(...buttonHeights)).toBeGreaterThanOrEqual(44);

  await assertNoHorizontalOverflow(page);

  await page.screenshot({
    path: path.join(artifactsDir, "mobile-full.png"),
    fullPage: true
  });
});

test("critical accessibility issues are not present on the main page", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  const accessibilityScanResults = await new AxeBuilder({ page }).analyze();

  expect(accessibilityScanResults.violations).toEqual([]);
});

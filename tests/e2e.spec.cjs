const { test, expect } = require("playwright/test");

const url = "http://127.0.0.1:8091/";

test.use({ channel: "chrome" });

test("desktop dashboard core UI works", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.dashboardActions && document.querySelector(".maplibregl-canvas"));

  await expect(page.locator("h1")).toHaveText("USA Spending Watch");
  await expect(page.locator(".logo")).toHaveText("USA");
  await expect(page.locator('input[placeholder="Search jurisdiction..."]')).toBeVisible();
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();

  await page.locator('input[placeholder="Search jurisdiction..."]').fill("Clark");
  await expect(page.getByText("Clark County").first()).toBeVisible();

  await page.getByText("Clark County").first().click();
  await expect(page.locator("#rupModal")).toHaveClass(/open/);
  await expect(page.locator("#modalBody")).toContainText("USAspending.gov Federal Aggregate");
  await page.locator("#rupModal .modal-top button").click();
  await expect(page.locator("#rupModal")).not.toHaveClass(/open/);

  await page.locator("#legend-container .legend-btn").click();
  await expect(page.locator("#legend-container")).toHaveClass(/open/);
  await page.locator("#legend-container .legend-btn").click();

  await page.locator("#feedbackButton").click();
  await expect(page.locator("#feedbackPanel")).toHaveClass(/open/);
  await page.locator("#feedbackPanel textarea").fill("QA smoke test");
  await page.locator('#feedbackPanel button[aria-label="Close feedback"]').click();
  await expect(page.locator("#feedbackPanel")).not.toHaveClass(/open/);
});

test("mobile HUD controls do not overlap", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.dashboardActions && document.querySelector(".maplibregl-ctrl-top-left"));

  await expect(page.locator("h1")).toHaveText("USA Spending Watch");
  await expect(page.locator('input[placeholder="Search jurisdiction..."]')).toBeVisible();

  const layout = await page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const r = element.getBoundingClientRect();
      return {
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        left: r.left,
        width: r.width,
        height: r.height,
      };
    };
    return {
      header: rect(".hdr"),
      controls: rect(".maplibregl-ctrl-top-left"),
      kpiButton: rect(".mobile-kpi-btn"),
      sidebar: rect("#sidebar"),
      map: rect("#map"),
      bodyWidth: document.documentElement.clientWidth,
    };
  });

  expect(layout.header).toBeTruthy();
  expect(layout.controls).toBeTruthy();
  expect(layout.controls.top).toBeGreaterThanOrEqual(layout.header.bottom - 1);
  expect(layout.controls.left).toBeGreaterThanOrEqual(0);
  expect(layout.controls.right).toBeLessThanOrEqual(layout.bodyWidth);
  expect(layout.kpiButton.right).toBeLessThanOrEqual(layout.bodyWidth);

  await page.locator(".mobile-kpi-btn").click();
  await expect(page.locator("#kpi")).toHaveClass(/open/);
  await page.locator("#kpiBackdrop").click();
  await expect(page.locator("#kpi")).not.toHaveClass(/open/);

  await page.locator("#feedbackButton").click();
  await expect(page.locator("#feedbackPanel")).toHaveClass(/open/);
});

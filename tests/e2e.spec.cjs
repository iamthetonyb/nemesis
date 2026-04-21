const { test, expect } = require("playwright/test");

const url = process.env.E2E_URL || "http://127.0.0.1:8091/";

test.use({ channel: "chrome" });

test("desktop dashboard core UI works", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.dashboardActions && document.querySelector(".maplibregl-canvas"));

  await expect(page.locator(".hdr-t h1")).toHaveText("USA Spending Watch");
  await expect(page.locator(".logo")).toHaveText("USA");
  await expect(page.locator(".sensory-toggle")).toHaveText("SFX on");
  await expect(page.locator('input[placeholder="Search jurisdiction..."]')).toBeVisible();
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();

  const beforeMotion = await page.evaluate(() => {
    const button = document.querySelector(".btn-map");
    if (!button) return null;
    return {
      animationState: getComputedStyle(button).animationPlayState,
      snap: getComputedStyle(document.documentElement).scrollSnapType,
    };
  });
  await page.locator(".btn-map").hover();
  const afterMotion = await page.evaluate(() => {
    const button = document.querySelector(".btn-map");
    return button ? getComputedStyle(button).animationPlayState : null;
  });
  expect(beforeMotion.animationState).toBe("running");
  expect(beforeMotion.snap).not.toContain("mandatory");
  expect(afterMotion).toBe("running");

  await page.locator(".sensory-toggle").click();
  await expect(page.locator(".sensory-toggle")).toHaveText("SFX off");
  await expect(page.locator(".sensory-toggle")).toHaveAttribute("aria-pressed", "false");
  await page.locator(".sensory-toggle").click();
  await expect(page.locator(".sensory-toggle")).toHaveText("SFX on");

  await page.locator('input[placeholder="Search jurisdiction..."]').fill("Clark");
  await expect(page.getByText("Clark County").first()).toBeVisible();

  await page.getByText("Clark County").first().click();
  await expect(page.locator("#rupModal")).toHaveClass(/open/);
  await expect(page.locator("#modalBody")).toContainText("USAspending.gov Federal Aggregate");
  await page.locator("#rupModal .modal-top button").click();
  await expect(page.locator("#rupModal")).not.toHaveClass(/open/);

  await expect(page.locator("#legend")).toBeVisible();

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

  await expect(page.locator(".hdr-t h1")).toHaveText("USA Spending Watch");
  await expect(page.locator(".sensory-toggle")).toBeVisible();
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
      sensory: rect(".sensory-toggle"),
      feedback: rect("#feedbackButton"),
      cta: rect(".btn-map"),
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
  expect(layout.sensory.right).toBeLessThan(layout.feedback.left);
  expect(layout.cta.width).toBeGreaterThan(330);
  expect(layout.cta.height).toBeGreaterThanOrEqual(88);

  await page.locator(".mobile-kpi-btn").click();
  await expect(page.locator("#kpi")).toHaveClass(/open/);
  await page.mouse.click(10, 830);
  await expect(page.locator("#kpi")).not.toHaveClass(/open/);

  await page.locator("#feedbackButton").click();
  await expect(page.locator("#feedbackPanel")).toHaveClass(/open/);
});

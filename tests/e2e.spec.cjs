const { test, expect } = require("playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;

const url = process.env.E2E_URL || "http://127.0.0.1:8091/";

test.use({ channel: "chrome" });

test("desktop dashboard core UI works", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.dashboardActions && document.querySelector(".maplibregl-canvas"));

  await expect(page.locator(".hdr-t .app-title")).toHaveText("USA Spending Watch");
  await expect(page.locator(".logo")).toHaveText("USA");
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /gov-budget\.pages\.dev/);
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(1);
  const externalAssets = await page.evaluate(() =>
    [...document.querySelectorAll("script[src],link[href]")]
      .map((node) => node.getAttribute("src") || node.getAttribute("href") || "")
      .filter((url) => /fonts\.googleapis|fonts\.gstatic|unpkg/.test(url))
  );
  expect(externalAssets).toEqual([]);
  await expect(page.locator(".sensory-toggle")).toHaveText("FX on");
  await expect(page.locator(".sound-toggle")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".hero-bg-video")).toHaveAttribute("poster", /hero-poster\.jpg/);
  await expect.poll(() => page.locator(".hero-bg-video").evaluate((node) => node.getAttribute("src") || "")).toContain("hero-motion.mp4");
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.videoMotion || ""))
    .toBe("playing");
  const heroMotion = await page.evaluate(async () => {
    const hero = document.querySelector(".hero");
    const video = document.querySelector(".hero-bg-video");
    const startTime = video.currentTime;
    const startTransform = getComputedStyle(video).transform;
    await new Promise((resolve) => setTimeout(resolve, 900));
    return {
      videoDelta: video.currentTime - startTime,
      paused: video.paused,
      readyState: video.readyState,
      transformChanged: getComputedStyle(video).transform !== startTransform,
      videoAnimation: getComputedStyle(video).animationName,
      overlayAnimation: getComputedStyle(hero, "::after").animationName,
    };
  });
  expect(heroMotion.videoDelta).toBeGreaterThan(0.03);
  expect(heroMotion.paused).toBe(false);
  expect(heroMotion.readyState).toBeGreaterThanOrEqual(2);
  expect(heroMotion.transformChanged).toBe(true);
  expect(heroMotion.videoAnimation).toContain("hero-video-drift");
  expect(heroMotion.overlayAnimation).toContain("hero-scan");
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
  await expect(page.locator(".sensory-toggle")).toHaveText("FX off");
  await expect(page.locator(".sensory-toggle")).toHaveAttribute("aria-pressed", "false");
  const offMotion = await page.evaluate(() => ({
    sparkle: getComputedStyle(document.querySelector(".sp")).animationName,
    scrollCue: getComputedStyle(document.querySelector(".scroll-cue")).animationName,
    mapButton: getComputedStyle(document.querySelector(".btn-map")).animationName,
    heroOverlay: getComputedStyle(document.querySelector(".hero"), "::after").display,
    videoSrc: document.querySelector(".hero-bg-video").getAttribute("src") || "",
  }));
  expect(offMotion).toEqual({ sparkle: "none", scrollCue: "none", mapButton: "none", heroOverlay: "none", videoSrc: "" });
  await page.locator(".sensory-toggle").click();
  await expect(page.locator(".sensory-toggle")).toHaveText("FX on");

  await page.locator(".sound-toggle").click();
  await expect(page.locator(".sound-toggle")).toHaveAttribute("aria-pressed", "false");
  await page.locator(".sound-toggle").click();
  await expect(page.locator(".sound-toggle")).toHaveAttribute("aria-pressed", "true");
  await expect(page.evaluate(() => window.Sensory && window.Sensory.isFeedbackEnabled())).resolves.toBe(true);

  await page.locator("#mf").getByText("State", { exact: true }).click();
  await expect(page.locator("#sbc")).toContainText("Nevada");
  await expect(page.locator(".map-label").first()).toContainText("Nevada");
  await page.locator("#mf").getByText("All Sources", { exact: true }).click();
  await expect(page.locator("#tabs").getByText("County", { exact: true })).toBeEnabled();
  await expect(page.locator("#tabs").getByText("County", { exact: true })).toHaveClass(/a/);

  await page.locator('input[placeholder="Search jurisdiction..."]').fill("Clark");
  const clarkCard = page.locator("#sbc .pi").filter({ hasText: "Clark County" }).first();
  await expect(clarkCard).toBeVisible();

  await clarkCard.click();
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

  await expect(page.locator(".hdr-t .app-title")).toHaveText("USA Spending Watch");
  await expect(page.locator(".sensory-toggle")).toBeVisible();
  await expect(page.locator(".sound-toggle")).toBeVisible();
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
      effectControls: rect(".effect-controls"),
      feedback: rect("#feedbackButton"),
      cta: rect(".btn-map"),
      heroVideo: rect(".hero-bg-video"),
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
  expect(layout.effectControls.right).toBeLessThan(layout.feedback.left);
  expect(layout.cta.width).toBeGreaterThan(330);
  expect(layout.cta.height).toBeGreaterThanOrEqual(88);
  expect(layout.heroVideo.width).toBeGreaterThan(300);

  await page.locator(".mobile-kpi-btn").click();
  await expect(page.locator("#kpi")).toHaveClass(/open/);
  await page.mouse.click(10, 830);
  await expect(page.locator("#kpi")).not.toHaveClass(/open/);

  await page.locator("#feedbackButton").click();
  await expect(page.locator("#feedbackPanel")).toHaveClass(/open/);
});

test("core content remains readable without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });

  await expect(page.locator("h1")).toContainText("Where your");
  await expect(page.locator(".no-js")).toContainText("FY 2026");
  await expect(page.locator(".no-js img")).toHaveAttribute("width", "1280");
  await expect(page.locator(".no-js img")).toHaveAttribute("height", "672");

  await context.close();
});

test("home page has no WCAG AA axe violations", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.dashboardActions && document.querySelector(".maplibregl-canvas"));

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();

  expect(results.violations).toEqual([]);
});

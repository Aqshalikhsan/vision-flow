import { expect, test } from "@playwright/test";

test("Research workspace exposes the architecture builder and method catalog", async ({
  page,
}) => {
  await page.goto("/#/research", {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await expect(
    page.getByRole("heading", { name: "Rancang model deteksi sendiri" }),
  ).toBeVisible();
  const columns = page.locator(".research-catalog-columns article");
  await expect(columns.nth(0).locator("h3")).toContainText("Backbone37");
  await expect(columns.nth(1).locator("h3")).toContainText("Neck24");
  await expect(columns.nth(2).locator("h3")).toContainText("Head36");
  await expect(page.getByText("Adapter Studio", { exact: true })).toBeVisible();
  const builder = page.locator(".research-builder-grid");
  await builder.locator("select").nth(1).selectOption("bifpn");
  await expect(
    page.getByText("Adapter runtime belum tersedia", { exact: true }),
  ).toBeVisible();
  await builder.locator("select").nth(2).selectOption("yolov10-end2end");
  await expect(builder.locator("select").nth(2)).toHaveValue("yolov10-end2end");
  await page.getByPlaceholder("Cari ResNet, BiFPN, DETR...").fill("BiFPN");
  await expect(page.getByRole("button", { name: /^BiFPN / })).toBeVisible();
  await expect(
    page.getByText("Adapter", { exact: true }).first(),
  ).toBeVisible();
});

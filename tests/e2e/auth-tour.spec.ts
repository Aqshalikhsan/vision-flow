import { expect, test } from "@playwright/test";

test("Gmail OTP first login tours the real E2E project through detected deployment image", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:8004");

  await expect(
    page.getByRole("heading", { name: /Buat akun workspace|Selamat datang kembali/ }),
  ).toBeVisible();
  if (await page.getByLabel("Name").count()) {
    await page.getByLabel("Name").fill("OTP UI E2E User");
  }
  await page.getByLabel("Email").fill("otp-ui@gmail.com");
  await page.getByRole("button", { name: "Kirim OTP Gmail" }).click();
  await expect(page.getByLabel("Kode OTP 6 digit")).toBeVisible();
  await page.getByLabel("Kode OTP 6 digit").fill("123456");
  await page.getByRole("button", { name: "Verifikasi & login" }).click();

  await expect(page.getByRole("heading", { name: "Kenali project E2E COCO8" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page).toHaveURL(/e2e-coco8-detection-20260828-153649-2637\/project/);

  for (const heading of [
    "Periksa gambar dan bounding box",
    "Dataset dibuat immutable",
    "Ikuti epoch, batch, loss, dan checkpoint",
    "Periksa best.pt dan metrik",
    "Jalankan inference objek nyata",
  ]) {
    await page.getByRole("button", { name: /Lanjut/ }).click();
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }

  await expect(page).toHaveURL(/e2e-coco8-detection-20260828-153649-2637\/deploy/);
  await expect(page.locator(".inference-box").first()).toBeVisible({ timeout: 120_000 });
  await expect(page.locator(".inference-box").first()).toContainText(/\d+%/);
  await page.screenshot({ path: ".tmp/auth-tour-deployment.png", fullPage: true });

  await page.getByRole("button", { name: /Selesai/ }).click();
  await expect(page.getByRole("heading", { name: "Jalankan inference objek nyata" })).toBeHidden();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Jalankan inference objek nyata" })).toHaveCount(0);
});

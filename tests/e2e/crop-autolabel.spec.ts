import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const baseUrl = process.env.SALNOVA_TEST_BASE_URL || "http://127.0.0.1:8010";

test("reviewed boxes become examples and uploads expose crop", async ({
  page,
  request,
}) => {
  const created = await request.post(`${baseUrl}/api/projects`, {
    data: {
      name: "Exemplar crop browser test",
      type: "Object Detection",
      classes: ["object"],
    },
  });
  expect(created.ok()).toBeTruthy();
  const project = await created.json();
  const source = await readFile(
    resolve("datasets/coco8/images/train/000000000009.jpg"),
  );

  for (const name of ["example.jpg", "target.jpg"]) {
    const uploaded = await request.post(
      `${baseUrl}/api/projects/${project.id}/assets`,
      {
        multipart: { files: { name, mimeType: "image/jpeg", buffer: source } },
      },
    );
    expect(uploaded.ok()).toBeTruthy();
  }
  const withAssets = await request.get(`${baseUrl}/api/projects/${project.id}`);
  const assets = (await withAssets.json()).assets;
  const saved = await request.put(
    `${baseUrl}/api/projects/${project.id}/assets/${assets[0].id}/annotations`,
    { data: { boxes: [{ x: 20, y: 20, w: 35, h: 35, label: "object" }] } },
  );
  expect(saved.ok()).toBeTruthy();

  await page.goto(`${baseUrl}/#/projects/${project.id}/annotate`);
  await page.getByRole("button", { name: "Gambar berikutnya" }).click();
  const autoLabel = page.getByRole("button", {
    name: "Auto-label dari contoh",
  });
  await expect(autoLabel).toBeEnabled();
  await autoLabel.click();
  await expect(page.locator(".auto-label-suggestion").first()).toBeVisible();

  const beforeAccept = await request.get(
    `${baseUrl}/api/projects/${project.id}`,
  );
  expect((await beforeAccept.json()).assets[1].boxes).toHaveLength(0);
  await page.getByRole("button", { name: /Terima \d+/ }).click();
  await expect(page.locator(".auto-label-suggestion")).toHaveCount(0);
  const afterAccept = await request.get(
    `${baseUrl}/api/projects/${project.id}`,
  );
  const acceptedAsset = (await afterAccept.json()).assets[1];
  expect(acceptedAsset.boxes.length).toBeGreaterThan(0);
  expect(acceptedAsset.metadata.exampleLocked).toBe("true");

  await page.goto(`${baseUrl}/#/projects/${project.id}/project`);
  await page.locator('input[type="file"]').setInputFiles({
    name: "crop-me.jpg",
    mimeType: "image/jpeg",
    buffer: source,
  });
  await expect(
    page.getByRole("heading", { name: "Atur area dataset" }),
  ).toBeVisible();
  const cropSurface = page.locator(".crop-selection-surface");
  const bounds = await cropSurface.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(
    bounds!.x + bounds!.width * 0.2,
    bounds!.y + bounds!.height * 0.2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds!.x + bounds!.width * 0.8,
    bounds!.y + bounds!.height * 0.75,
  );
  await page.mouse.up();
  await expect(page.getByText("Crop aktif", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Crop & upload" }).click();
  await expect(
    page.getByRole("heading", { name: "Atur area dataset" }),
  ).toBeHidden({
    timeout: 30_000,
  });

  const afterCrop = await request.get(`${baseUrl}/api/projects/${project.id}`);
  const lastAsset = (await afterCrop.json()).assets.at(-1);
  expect(lastAsset.metadata.crop.w).toBeLessThan(100);
  expect(lastAsset.metadata.crop.h).toBeLessThan(100);
});

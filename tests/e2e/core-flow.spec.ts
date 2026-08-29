import { expect, test } from "@playwright/test";

const API = "http://127.0.0.1:8000";
let projectId = "";

test.beforeAll(async ({ request }) => {
  const existing = await request.get(`${API}/api/projects`);
  if (existing.ok()) {
    for (const project of (await existing.json()) as Array<{
      id: string;
      name: string;
    }>) {
      if (project.name.startsWith("Browser E2E"))
        await request.delete(`${API}/api/projects/${project.id}`);
    }
  }
  const created = await request.post(`${API}/api/projects`, {
    data: {
      name: `Browser E2E ${Date.now()}`,
      type: "Object Detection",
      description: "Disposable browser test",
      classes: ["carton"],
      colors: { carton: "#7a62ed" },
    },
  });
  expect(created.ok()).toBeTruthy();
  projectId = (await created.json()).id;
  const bitmap = Buffer.alloc(70);
  bitmap.write("BM");
  bitmap.writeUInt32LE(70, 2);
  bitmap.writeUInt32LE(54, 10);
  bitmap.writeUInt32LE(40, 14);
  bitmap.writeInt32LE(2, 18);
  bitmap.writeInt32LE(2, 22);
  bitmap.writeUInt16LE(1, 26);
  bitmap.writeUInt16LE(24, 28);
  bitmap.writeUInt32LE(16, 34);
  bitmap.fill(180, 54);
  const uploaded = await request.post(
    `${API}/api/projects/${projectId}/assets`,
    {
      multipart: {
        files: { name: "e2e.bmp", mimeType: "image/bmp", buffer: bitmap },
      },
    },
  );
  expect(uploaded.ok()).toBeTruthy();
});

test.afterAll(async ({ request }) => {
  if (projectId) await request.delete(`${API}/api/projects/${projectId}`);
});

test("dashboard to annotation, versions, training, and deployment", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await expect(page.getByRole("button", { name: /^Active/ })).toBeVisible();
  await page.keyboard.press("Control+K");
  const globalSearch = page.getByPlaceholder("Search projects and navigate…");
  await expect(globalSearch).toBeVisible();
  await globalSearch.fill("Browser E2E");
  await page
    .locator(".command-group button")
    .filter({ hasText: "Browser E2E" })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: /Browser E2E/ }),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/project$`));
  await page.getByRole("button", { name: "Back" }).click();
  const projectCard = page
    .locator(".project-card")
    .filter({ hasText: "Browser E2E" });
  await projectCard.getByRole("button", { name: /Actions for/ }).click();
  await expect(
    projectCard.getByRole("button", { name: "Duplicate" }),
  ).toBeVisible();
  await expect(
    projectCard.getByRole("button", { name: "Archive" }),
  ).toBeVisible();
  await projectCard.getByRole("button", { name: /Actions for/ }).click();
  await projectCard.locator(".project-card-main").click();

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Description").fill("Updated by browser coverage");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Updated by browser coverage")).toBeVisible();

  const projectTabs = page.getByTestId("project-tabs");
  await projectTabs
    .getByRole("button", { name: "Dataset", exact: true })
    .click();
  await page.getByRole("button", { name: "Import annotated dataset" }).click();
  await expect(
    page.getByRole("heading", { name: "Import existing annotations" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /COCO JSON/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Pascal VOC/ })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const importModalFits = await page
    .locator(".annotated-import-modal")
    .evaluate((modal) => {
      const bounds = modal.getBoundingClientRect();
      return bounds.left >= 0 && bounds.right <= window.innerWidth;
    });
  expect(importModalFits).toBeTruthy();
  await page.setViewportSize({ width: 1280, height: 720 });
  const projectSnapshot = await (
    await page.request.get(`${API}/api/projects/${projectId}`)
  ).json();
  await page.route(
    `**/api/projects/${projectId}/import/annotated`,
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 800));
      await route.fulfill({ json: projectSnapshot });
    },
  );
  await page
    .locator('.annotated-import-modal input[type="file"]')
    .setInputFiles({
      name: "annotated-e2e.zip",
      mimeType: "application/zip",
      buffer: Buffer.alloc(1024 * 1024, 1),
    });
  const importProgress = page.getByRole("progressbar", {
    name: /Uploading annotated-e2e\.zip/,
  });
  await expect(importProgress).toBeVisible();
  await expect(importProgress).toHaveAttribute("aria-valuemin", "0");
  await expect(importProgress).toHaveAttribute("aria-valuemax", "100");
  await expect(importProgress).toHaveAttribute("aria-valuenow", /\d+/);
  await expect(page.locator(".annotated-import-modal")).toBeHidden();
  await page.unroute(`**/api/projects/${projectId}/import/annotated`);
  await page.getByRole("button", { name: "Select e2e.bmp" }).click();
  await expect(page.getByText("1 selected")).toBeVisible();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.locator(".review-select")).toHaveValue("approved");

  await projectTabs
    .getByRole("button", { name: "Health & Jobs", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Health, jobs & active learning" }),
  ).toBeVisible();
  await expect(page.getByText("Dataset health", { exact: true })).toBeVisible();

  await projectTabs
    .getByRole("button", { name: "Annotate", exact: true })
    .click();
  await expect(page.getByText("CLASSES", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^carton\s+0$/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/project$`));
  await expect(
    page.getByText("Project progress", { exact: true }),
  ).toBeVisible();
  await page
    .getByTestId("project-tabs")
    .getByRole("button", { name: "Annotate", exact: true })
    .click();
  const generateVersion = page.getByRole("button", {
    name: /Saved · Generate Version/,
  });
  await expect(generateVersion).toBeVisible();
  await generateVersion.click();
  await expect(
    page.getByRole("heading", { name: "Dataset versions" }),
  ).toBeVisible();
  await expect(page.getByText(/Augmentation studio/)).toBeVisible();

  await page
    .getByTestId("project-tabs")
    .getByRole("button", { name: "Train", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: /Train a detection model/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Start training/ }),
  ).toBeDisabled();
  await expect(page.getByText("Laptop workers", { exact: true })).toBeVisible();
  const trainingLocation = page.getByLabel("Training location");
  await expect(trainingLocation).toBeVisible();
  await trainingLocation.selectOption("remote-auto");
  await expect(page.getByLabel("External worker")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.setViewportSize({ width: 1280, height: 720 });

  await page
    .getByTestId("project-tabs")
    .getByRole("button", { name: "Deploy", exact: true })
    .click();
  await expect(page.getByText("No trained model available")).toBeVisible();

  await page.getByRole("button", { name: "Workflows", exact: true }).click();
  await expect(page.locator(".connection-item").first()).toBeVisible();
  const connectionContained = await page
    .locator(".connection-item")
    .evaluateAll((items) =>
      items.every((item) => {
        const container = item.getBoundingClientRect();
        const remove = item.querySelector("button")!.getBoundingClientRect();
        return (
          remove.left >= container.left &&
          remove.right <= container.right &&
          remove.top >= container.top &&
          remove.bottom <= container.bottom
        );
      }),
    );
  expect(connectionContained).toBeTruthy();
});

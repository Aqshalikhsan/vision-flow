import { expect, test } from "@playwright/test";

const API = "http://127.0.0.1:8000";
let projectId = "";

test.beforeAll(async ({ request }) => {
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

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Description").fill("Updated by browser coverage");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Updated by browser coverage")).toBeVisible();

  const projectTabs = page.getByTestId("project-tabs");
  await projectTabs
    .getByRole("button", { name: "Dataset", exact: true })
    .click();
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

  await page
    .getByTestId("project-tabs")
    .getByRole("button", { name: "Deploy", exact: true })
    .click();
  await expect(page.getByText("No trained model available")).toBeVisible();
});

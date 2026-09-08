import { expect, test } from "@playwright/test";

const API = "http://127.0.0.1:8010";
let projectId = "";

function bitmap(name: string) {
  const image = Buffer.alloc(70);
  image.write("BM");
  image.writeUInt32LE(70, 2);
  image.writeUInt32LE(54, 10);
  image.writeUInt32LE(40, 14);
  image.writeInt32LE(2, 18);
  image.writeInt32LE(2, 22);
  image.writeUInt16LE(1, 26);
  image.writeUInt16LE(24, 28);
  image.writeUInt32LE(16, 34);
  image.fill(name.charCodeAt(name.length - 5), 54);
  return image;
}

test.beforeAll(async ({ request }) => {
  const created = await request.post(`${API}/api/projects`, {
    data: {
      name: `Annotation jump E2E ${Date.now()}`,
      type: "Semantic Segmentation",
      description: "Disposable jump navigation test",
      classes: ["object"],
      colors: { object: "#7a62ed" },
    },
  });
  expect(created.ok()).toBeTruthy();
  projectId = (await created.json()).id;

  for (const name of ["jump-1.bmp", "jump-2.bmp", "jump-3.bmp"]) {
    const uploaded = await request.post(
      `${API}/api/projects/${projectId}/assets`,
      {
        multipart: {
          files: { name, mimeType: "image/bmp", buffer: bitmap(name) },
        },
      },
    );
    expect(uploaded.ok()).toBeTruthy();
  }
});

test.afterAll(async ({ request }) => {
  if (projectId) await request.delete(`${API}/api/projects/${projectId}`);
});

test("semantic annotator jumps directly to a numbered dataset item", async ({
  page,
}) => {
  await page.goto(`/#/projects/${projectId}/annotate`);
  const number = page.getByRole("spinbutton", {
    name: "Nomor dataset",
    exact: true,
  });
  await expect(number).toHaveValue("1");
  await expect(page.getByText("jump-1.bmp", { exact: true })).toBeVisible();

  await number.fill("3");
  await number.press("Enter");
  await expect(number).toHaveValue("3");
  await expect(page.getByText("jump-3.bmp", { exact: true })).toBeVisible();

  await number.fill("999");
  await page.getByRole("button", { name: "Lompat ke nomor dataset" }).click();
  await expect(number).toHaveValue("3");
  await expect(page.getByText("jump-3.bmp", { exact: true })).toBeVisible();

  await number.fill("1");
  await number.press("Enter");
  await expect(page.getByText("jump-1.bmp", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Gambar sebelumnya" }),
  ).toBeDisabled();
});

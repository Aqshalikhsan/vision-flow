import { defineConfig } from "@playwright/test";

const python =
  process.env.PYTHON_EXECUTABLE ||
  (process.platform === "win32"
    ? ".\\.venv313\\Scripts\\python.exe"
    : "python");
const chromePath =
  process.env.PLAYWRIGHT_CHROME_PATH ||
  (process.platform === "win32"
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : undefined);

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  reporter: [["list"]],
  webServer: [
    {
      command: `${python} -m uvicorn backend.main:app --host 127.0.0.1 --port 8010`,
      url: "http://127.0.0.1:8010/api/health",
      env: { ...process.env, VISIONFLOW_REQUIRE_AUTH: "0" },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  use: {
    baseURL: "http://127.0.0.1:8010",
    headless: true,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    launchOptions: chromePath ? { executablePath: chromePath } : {},
  },
});

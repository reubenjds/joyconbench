import { defineConfig, devices } from '@playwright/test';

const serverHost = '127.0.0.1';
const serverPort = process.env.PLAYWRIGHT_PORT ?? '5173';
const baseURL = `http://${serverHost}:${serverPort}`;
const serverCommand = process.env.CI ? 'vite preview' : 'vite';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm exec ${serverCommand} --host ${serverHost} --port ${serverPort} --strictPort`,
    url: baseURL,
    wait: { stdout: new RegExp(`Local:\\s+${baseURL.replaceAll('.', '\\.')}\\/`) },
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 30_000,
  },
});

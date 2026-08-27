import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const makeReport = () => {
      const bytes = new Uint8Array(48);
      const view = new DataView(bytes.buffer);
      bytes[0] = Math.floor(performance.now() / 16) & 0xff;
      bytes[1] = 0x80;
      bytes[5] = 0x00;
      bytes[6] = 0x08;
      bytes[7] = 0x80;
      bytes[8] = 0x00;
      bytes[9] = 0x08;
      bytes[10] = 0x80;
      const phase = performance.now() / 180;
      for (let frame = 0; frame < 3; frame += 1) {
        const gyroOffset = 18 + frame * 12;
        view.setInt16(gyroOffset, Math.round(Math.sin(phase + frame * 0.1) * 900), true);
        view.setInt16(gyroOffset + 2, Math.round(Math.cos(phase + frame * 0.1) * 700), true);
        view.setInt16(gyroOffset + 4, Math.round(Math.sin(phase * 0.6) * 500), true);
      }
      return view;
    };

    class MockDevice extends EventTarget {
      opened = false;
      vendorId = 0x057e;
      collections = [{ usagePage: 1, usage: 5, outputReports: [{ reportId: 0x01 }] }];
      timer?: number;
      constructor(
        readonly productId: number,
        readonly productName: string
      ) {
        super();
      }
      async open() {
        this.opened = true;
      }
      async close() {
        this.opened = false;
        if (this.timer) window.clearInterval(this.timer);
      }
      async sendReport(reportId: number, data: Uint8Array) {
        if (reportId === 0x01 && data[9] === 0x10) {
          const reply = new Uint8Array(50);
          reply[12] = 0x90;
          reply[13] = 0x10;
          reply.set(data.slice(10, 14), 14);
          reply[18] = data[14];
          reply.set([0x6a, 0x4b, 0xc3, 0x21, 0x16, 0x2f, 0xff, 0x32, 0x78, 0x1e, 0xdc, 0x00], 19);
          queueMicrotask(() => {
            const event = new Event('inputreport');
            Object.defineProperties(event, {
              reportId: { value: 0x21 },
              data: { value: new DataView(reply.buffer) },
              device: { value: this },
            });
            this.dispatchEvent(event);
          });
        }
        if (reportId === 0x01 && data[9] === 0x03 && data[10] === 0x30 && !this.timer) {
          this.timer = window.setInterval(() => {
            const event = new Event('inputreport');
            Object.defineProperties(event, {
              reportId: { value: 0x30 },
              data: { value: makeReport() },
              device: { value: this },
            });
            this.dispatchEvent(event);
          }, 16);
        }
      }
    }
    const leftJoyCon = new MockDevice(0x2006, 'Joy-Con (L)');
    const rightJoyCon = new MockDevice(0x2007, 'Joy-Con (R)');
    let pickerCount = 0;
    const hid = new (class extends EventTarget {
      async getDevices() {
        return [leftJoyCon, rightJoyCon];
      }
      async requestDevice() {
        const selected = pickerCount === 0 ? rightJoyCon : leftJoyCon;
        pickerCount += 1;
        return [selected];
      }
    })();
    Object.defineProperty(navigator, 'hid', { configurable: true, value: hid });
  });
});

test('connects a mocked Joy-Con into colours before the test playground', async ({ page }) => {
  const externalRequests: string[] = [];
  const applicationOrigin = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? '5173'}`;
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== applicationOrigin) externalRequests.push(request.url());
  });

  await page.goto('/');
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/icon.svg');
  await expect(page.getByRole('heading', { name: /Test your controller/i })).toBeVisible();
  await page.getByRole('button', { name: 'Connect controller' }).click();
  await page.getByRole('button', { name: 'Open controller picker' }).click();
  await expect(page.getByText('Right Joy-Con').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Controller colours' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Colours', exact: true })).toHaveAttribute(
    'aria-current',
    'page'
  );
  await page
    .getByRole('navigation', { name: 'Controller workspaces' })
    .getByRole('button', { name: 'Tests' })
    .click();
  await expect(page.getByRole('heading', { name: 'Button test' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Joystick movement' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Left stick' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Right stick' })).toBeVisible();
  await expect(page.locator('.device-strip')).toContainText('100% battery');
  await expect(page.locator('.joystick-monitor-heading output')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Stick drift' })).toBeVisible();
  const testCards = page.locator('.test-card');
  const regularCardBox = await testCards.nth(1).boundingBox();
  const finalCardBox = await testCards.last().boundingBox();
  expect(regularCardBox).not.toBeNull();
  expect(finalCardBox).not.toBeNull();
  expect(finalCardBox!.width).toBeGreaterThan(regularCardBox!.width * 1.5);

  const gyroCard = page.getByRole('article').filter({ hasText: 'Gyroscope at rest' });
  await gyroCard.getByRole('button').click();
  await expect(page.getByRole('heading', { name: 'Gyroscope at rest' })).toBeVisible();
  const clockBox = await page.locator('.capture-clock').boundingBox();
  const timerBox = await page.getByRole('timer').boundingBox();
  expect(clockBox).not.toBeNull();
  expect(timerBox).not.toBeNull();
  expect(clockBox!.width).toBeGreaterThanOrEqual(120);
  expect(timerBox!.x - clockBox!.x).toBeGreaterThanOrEqual(18);
  expect(timerBox!.y - clockBox!.y).toBeGreaterThanOrEqual(18);
  await expect(page.locator('.capture-ring-progress')).toBeVisible();
  await expect(page.getByRole('img', { name: /Live gyroscope X, Y, and Z axes/i })).toBeVisible();
  await expect(page.getByRole('img', { name: /Live gyroscope X and Y vector/i })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Gyroscope X', exact: true })).toContainText('°/s');
  await page.getByRole('button', { name: /Back to test suite/ }).click();
  await expect(page.locator('.diagram-panel .controller-diagram')).toHaveAttribute(
    'style',
    /--controller-body: #6a4bc3;.*--controller-buttons: #21162f;/
  );
  const controllerBox = await page.locator('.diagram-panel .controller-diagram').boundingBox();
  const joystickBox = await page.locator('.live-joysticks').boundingBox();
  expect(controllerBox).not.toBeNull();
  expect(joystickBox).not.toBeNull();
  expect(joystickBox!.x).toBeGreaterThan(controllerBox!.x);

  await page
    .getByRole('navigation', { name: 'Controller workspaces' })
    .getByRole('button', { name: 'Colours' })
    .click();
  const toolsEyebrow = page.getByText('Colours & backup', { exact: true });
  const toolsHeading = page.getByRole('heading', { name: 'Controller colours' });
  const eyebrowBox = await toolsEyebrow.boundingBox();
  const headingBox = await toolsHeading.boundingBox();
  expect(eyebrowBox).not.toBeNull();
  expect(headingBox).not.toBeNull();
  expect(eyebrowBox!.y).toBeLessThan(headingBox!.y);
  await expect(page.getByText('Retail colours')).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Loaded');
  await expect(page.getByRole('status')).toHaveClass(/tool-status-loaded/);
  await expect(page.locator('.tool-status-dot')).toHaveCSS('background-color', 'rgb(22, 131, 79)');
  await expect(page.getByRole('status')).toContainText('loaded automatically on connection');
  await expect(page.getByText('Backup scope')).toHaveCount(0);
  await expect(page.getByText(/Downloads as a \.bin file/)).toBeVisible();
  await expect(page.getByLabel('Body')).toHaveValue('#6a4bc3');
  await expect(page.getByLabel('Buttons')).toHaveValue('#21162f');
  await expect(page.locator('.retail-color')).toHaveCount(15);
  await page.getByRole('button', { name: 'Neon blue' }).click();
  await expect(page.getByLabel('Body')).toHaveValue('#0ab9e6');
  await expect(page.getByLabel('Buttons')).toHaveValue('#001e1e');
  await page.getByLabel('Body').fill('#0ab9e6');
  await page.getByLabel('Buttons').fill('#001e1e');
  await expect(page.getByLabel('Body')).toHaveValue('#0ab9e6');
  await expect(page.getByLabel('Buttons')).toHaveValue('#001e1e');

  await page
    .getByRole('navigation', { name: 'Controller workspaces' })
    .getByRole('button', { name: 'Tests' })
    .click();

  await page.getByRole('button', { name: 'Save button result' }).click();
  await page
    .getByRole('navigation', { name: 'Controller workspaces' })
    .getByRole('button', { name: /Results/ })
    .click();
  await expect(page.getByText(/Research-based reference ranges produce/i)).toBeVisible();
  await page.getByRole('button', { name: 'Finish report' }).click();
  await expect(page.getByRole('heading', { name: 'Your report is finished' })).toBeVisible();
  await page.getByRole('button', { name: /Start again/ }).click();
  await expect(page.getByRole('heading', { name: /Test your controller/i })).toBeVisible();
  await page.getByRole('button', { name: 'Connect controller' }).click();
  await expect(page.getByText('Give JoyConBench access.')).toBeVisible();
  await page.getByRole('button', { name: 'Open controller picker' }).click();
  await expect(page.locator('.device-strip')).toContainText('Left Joy-Con');
  await expect(page.getByRole('heading', { name: 'Controller colours' })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Controller workspaces' })
    .getByRole('button', { name: 'Tests' })
    .click();
  await expect(page.getByRole('heading', { name: 'Left stick' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Right stick' })).toHaveCount(0);
  expect(externalRequests).toEqual([]);
});

test('informational layout has no horizontal overflow at a narrow width', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect controller' }).click();
  const modal = page.getByRole('dialog', { name: 'Connect a controller' });
  await expect(modal).toBeVisible();
  await expect(modal.locator('.pairing-steps li')).toHaveCount(6);
  await expect(modal.getByText('SYNC', { exact: true })).toBeVisible();
  const modalBox = await modal.boundingBox();
  expect(modalBox).not.toBeNull();
  expect(modalBox!.x).toBeGreaterThanOrEqual(0);
  expect(modalBox!.x + modalBox!.width).toBeLessThanOrEqual(360);
  expect(modalBox!.y).toBeGreaterThanOrEqual(0);
  expect(modalBox!.y + modalBox!.height).toBeLessThanOrEqual(780);
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
});

test('returns to connection guidance when the active Joy-Con disconnects', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect controller' }).click();
  await page.getByRole('button', { name: 'Open controller picker' }).click();
  await expect(page.getByText('Right Joy-Con').first()).toBeVisible();

  await page.evaluate(async () => {
    const devices = await navigator.hid!.getDevices();
    const connected = devices.find((device) => device.productId === 0x2007)!;
    const event = new Event('disconnect');
    Object.defineProperty(event, 'device', { value: connected });
    navigator.hid!.dispatchEvent(event);
  });

  await expect(page.getByRole('heading', { name: /Test your controller/i })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText(/controller disconnected/i);
});

test('connected workbench layouts have no horizontal overflow at a narrow width', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect controller' }).click();
  await page.getByRole('button', { name: 'Open controller picker' }).click();
  await expect(page.getByRole('heading', { name: 'Controller colours' })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Controller workspaces' })
    .getByRole('button', { name: 'Tests' })
    .click();
  await expect(page.getByRole('heading', { name: 'Joystick movement' })).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);

  await page
    .getByRole('article')
    .filter({ hasText: 'Gyroscope at rest' })
    .getByRole('button')
    .click();
  await expect(page.getByRole('img', { name: /Live gyroscope X and Y vector/i })).toBeVisible();
  const gyroDimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(gyroDimensions.scrollWidth).toBeLessThanOrEqual(gyroDimensions.clientWidth);
  await page.getByRole('button', { name: /Back to test suite/ }).click();

  await page
    .getByRole('navigation', { name: 'Controller workspaces' })
    .getByRole('button', { name: 'Colours' })
    .click();
  await expect(page.getByText('Retail colours')).toBeVisible();
  const toolsDimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(toolsDimensions.scrollWidth).toBeLessThanOrEqual(toolsDimensions.clientWidth);
});

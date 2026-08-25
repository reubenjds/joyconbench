import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const makeReport = () => {
      const bytes = new Uint8Array(48);
      bytes[0] = Math.floor(performance.now() / 16) & 0xff;
      bytes[1] = 0x80;
      bytes[5] = 0x00;
      bytes[6] = 0x08;
      bytes[7] = 0x80;
      bytes[8] = 0x00;
      bytes[9] = 0x08;
      bytes[10] = 0x80;
      return new DataView(bytes.buffer);
    };

    class MockDevice extends EventTarget {
      opened = false;
      vendorId = 0x057e;
      productId = 0x2009;
      productName = 'Pro Controller';
      collections = [{ usagePage: 1, usage: 5, outputReports: [{ reportId: 0x01 }] }];
      timer?: number;
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
          reply.set([0x6a, 0x4b, 0xc3, 0x21, 0x16, 0x2f], 19);
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
    const device = new MockDevice();
    const hid = new (class extends EventTarget {
      async getDevices() {
        return [];
      }
      async requestDevice() {
        return [device];
      }
    })();
    Object.defineProperty(navigator, 'hid', { configurable: true, value: hid });
  });
});

test('connects a mocked Pro Controller directly into the button playground', async ({ page }) => {
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:5173')) externalRequests.push(request.url());
  });

  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: /See exactly what your controller/i })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Connect controller' }).click();
  await page.getByRole('button', { name: 'Open controller picker' }).click();
  await expect(page.getByText('Nintendo Switch Pro Controller').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Button test' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Joystick movement' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Left stick' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Right stick' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Stick drift' })).toBeVisible();
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
    .getByRole('navigation', { name: 'Workbench' })
    .getByRole('button', { name: 'Controller tools' })
    .click();
  const toolsEyebrow = page.getByText('Persistent tools', { exact: true });
  const toolsHeading = page.getByRole('heading', { name: 'Controller settings' });
  const eyebrowBox = await toolsEyebrow.boundingBox();
  const headingBox = await toolsHeading.boundingBox();
  expect(eyebrowBox).not.toBeNull();
  expect(headingBox).not.toBeNull();
  expect(eyebrowBox!.y).toBeLessThan(headingBox!.y);
  await expect(page.getByText('Retail colours')).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Complete');
  await expect(page.getByRole('status')).toHaveClass(/tool-status-complete/);
  await expect(page.locator('.tool-status-dot')).toHaveCSS('background-color', 'rgb(22, 131, 79)');
  await expect(page.getByRole('status')).toContainText('loaded automatically on connection');
  await expect(page.getByLabel('Body')).toHaveValue('#6a4bc3');
  await expect(page.getByLabel('Buttons')).toHaveValue('#21162f');
  await expect(page.locator('.retail-color')).toHaveCount(15);
  await page.getByRole('button', { name: 'Neon blue' }).click();
  await expect(page.getByLabel('Body')).toHaveValue('#0ab9e6');
  await expect(page.getByLabel('Buttons')).toHaveValue('#001e1e');

  await page
    .getByRole('navigation', { name: 'Workbench' })
    .getByRole('button', { name: 'Tests' })
    .click();

  await page.getByRole('button', { name: 'Save button result' }).click();
  await page
    .getByRole('navigation', { name: 'Workbench' })
    .getByRole('button', { name: /Results/ })
    .click();
  await page.getByRole('button', { name: 'Finish report' }).click();
  await expect(page.getByRole('heading', { name: 'Your report is finished' })).toBeVisible();
  await page.getByRole('button', { name: /Start again/ }).click();
  await expect(
    page.getByRole('heading', { name: /See exactly what your controller/i })
  ).toBeVisible();
  expect(externalRequests).toEqual([]);
});

test('informational layout has no horizontal overflow at a narrow width', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect controller' }).click();
  const modal = page.getByRole('dialog', { name: 'Connect a controller' });
  await expect(modal).toBeVisible();
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

test('connected workbench layouts have no horizontal overflow at a narrow width', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect controller' }).click();
  await page.getByRole('button', { name: 'Open controller picker' }).click();
  await expect(page.getByRole('heading', { name: 'Joystick movement' })).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);

  await page
    .getByRole('navigation', { name: 'Workbench' })
    .getByRole('button', { name: 'Controller tools' })
    .click();
  await expect(page.getByText('Retail colours')).toBeVisible();
  const toolsDimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(toolsDimensions.scrollWidth).toBeLessThanOrEqual(toolsDimensions.clientWidth);
});

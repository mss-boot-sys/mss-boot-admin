import { expect, test } from '@playwright/test';

function contrast(foreground: string, background: string) {
  const luminance = (color: string) => {
    const channels = color
      .match(/[\d.]+/g)
      ?.slice(0, 3)
      .map(Number);
    if (channels?.length !== 3) throw new Error(`Unexpected computed color: ${color}`);
    const linear = channels.map((value) => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return linear.reduce(
      (sum, value, index) => sum + value * ([0.2126, 0.7152, 0.0722][index] ?? 0),
      0,
    );
  };
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

// UI-only fixtures: no credentials or backend are needed for this regression.
for (const navTheme of ['light', 'realDark'] as const) {
  test(`login uses semantic button states and responsive background: ${navTheme}`, async ({
    page,
  }) => {
    // A cold Utoopack server first serves its Bundling screen. Reserve time for
    // that initial compilation without relaxing any button-state assertions.
    test.setTimeout(60_000);
    await page.addInitScript(() => localStorage.setItem('umi_locale', 'en-US'));
    let finishLogin: (() => void) | undefined;
    await page.route('**/admin/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/app-configs/profile')) {
        await route.fulfill({
          json: {
            base: {},
            security: { githubEnabled: true },
            theme: { navTheme, _meta: { v: 1, scope: 'application', revision: '1' } },
          },
        });
      } else if (path.endsWith('/user/session/login')) {
        await new Promise<void>((resolve) => {
          finishLogin = resolve;
        });
        await route.fulfill({ status: 401, json: { code: 401, msg: 'Fixture login failure' } });
      } else {
        await route.fulfill({ status: 404, json: {} });
      }
    });
    await page.goto('/user/login');
    const submit = page.locator('.mss-auth-submit');
    await expect(submit).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('html')).toHaveAttribute('data-mss-theme', navTheme);
    const colors = () =>
      submit.evaluate((button) => {
        const style = getComputedStyle(button);
        return {
          background: style.backgroundColor,
          foreground: style.color,
          primary: style.getPropertyValue('--mss-color-primary').trim(),
          hover: style.getPropertyValue('--mss-color-primary-hover').trim(),
          active: style.getPropertyValue('--mss-color-primary-active').trim(),
        };
      });
    // Resolve semantic colors with the browser, rather than copying brand hex values.
    const resolvedToken = async (token: string) =>
      submit.evaluate((button, name) => {
        const probe = document.createElement('span');
        probe.style.color = `var(${name})`;
        button.append(probe);
        const value = getComputedStyle(probe).color;
        probe.remove();
        return value;
      }, token);
    const normal = await colors();
    expect(normal.primary).not.toBe('');
    expect(normal.background).toBe(await resolvedToken('--mss-color-primary'));
    expect(normal.foreground).not.toBe(normal.background);
    const normalContrast = contrast(normal.foreground, normal.background);
    expect(normalContrast).toBeGreaterThanOrEqual(4.5);
    const states: Record<string, unknown> = { normal, normalContrast };
    await submit.focus();
    await expect(submit).toBeFocused();
    expect(await submit.evaluate((button) => getComputedStyle(button).outlineStyle)).not.toBe(
      'none',
    );
    await submit.hover();
    await expect
      .poll(async () => (await colors()).background)
      .toBe(await resolvedToken('--mss-color-primary-hover'));
    states.hover = await colors();
    await page.mouse.down();
    await expect
      .poll(async () => (await colors()).background)
      .toBe(await resolvedToken('--mss-color-primary-active'));
    states.active = await colors();
    await page.mouse.up();
    await page.mouse.move(0, 0);
    await page.getByLabel('Username', { exact: true }).fill('fixture-user');
    await page.getByLabel('Password', { exact: true }).fill('fixture-password');
    await submit.click();
    await expect.poll(() => Boolean(finishLogin)).toBe(true);
    await expect(submit).toHaveClass(/loading/);
    expect((await colors()).background).not.toBe('rgba(0, 0, 0, 0)');
    states.loading = await colors();
    finishLogin?.();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(submit).not.toHaveClass(/loading/);
    await page.mouse.move(0, 0);
    await expect.poll(async () => (await colors()).background).toBe(normal.background);
    // The login form does not ordinarily disable submit. Exercise native disabled
    // styling without altering authentication or inventing a production state.
    await submit.evaluate((button) => {
      (button as HTMLButtonElement).disabled = true;
    });
    await expect(submit).toBeDisabled();
    await expect.poll(async () => (await colors()).background).not.toBe(normal.background);
    states.disabled = await colors();
    await submit.evaluate((button) => {
      (button as HTMLButtonElement).disabled = false;
    });
    const mobile = (page.viewportSize()?.width ?? 1280) < 1024;
    const background = await page
      .locator('.mss-auth-main')
      .evaluate((main) => getComputedStyle(main).backgroundImage);
    expect(background.includes('radial-gradient')).toBe(mobile);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect.poll(async () => (await colors()).background).toBe(normal.background);
    await page.getByLabel('Password', { exact: true }).clear();
    await test.info().attach(`login-${navTheme}-contrast`, {
      body: JSON.stringify(
        { navTheme, viewport: page.viewportSize(), background, states },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    await test.info().attach(`login-${navTheme}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });
}

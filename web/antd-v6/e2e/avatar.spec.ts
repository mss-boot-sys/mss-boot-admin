import { expect, test } from '@playwright/test';
import { evaluatedContributions, trackContributionEvaluations } from './support/contributions';
import {
  API_BASE_URL,
  expectNoDocumentOverflow,
  login,
  ROOT_USERNAME,
  setLocale,
} from './support/session';

// These fixtures belong to the installed external Thin Host, not the reference
// application. The external-consumer script requires both exact test titles.
if (process.env.MSS_V6_AVATAR_PROBE === '1') {
  for (const scenario of [
    {
      name: 'desktop en-US light',
      locale: 'en-US' as const,
      viewport: { width: 1440, height: 1000 },
      theme: 'light',
      accountMenu: /Open the account menu for /,
      workplace: `Welcome, ${ROOT_USERNAME}`,
      center: 'Account center',
      settings: 'Personal settings',
      logout: 'Sign out',
      menuSearch: 'Open menu search',
      switchLanguage: 'Switch language',
    },
    {
      name: 'narrow zh-CN dark',
      locale: 'zh-CN' as const,
      viewport: { width: 390, height: 844 },
      theme: 'realDark',
      accountMenu: /打开 .+ 的账户菜单/,
      workplace: `欢迎，${ROOT_USERNAME}`,
      center: '账户中心',
      settings: '个人设置',
      logout: '退出登录',
      menuSearch: '打开菜单搜索',
      switchLanguage: '切换语言',
    },
  ]) {
    test(`@custom-content ${scenario.name} preserves avatar and layout content with core actions`, async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await trackContributionEvaluations(page);
      const consoleViolations: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'warning' || message.type() === 'error') {
          consoleViolations.push(`${message.type()}: ${message.text()}`);
        }
      });
      await page.setViewportSize(scenario.viewport);
      await setLocale(page, scenario.locale);
      // Keep identity and permission responses real. Vary only the personal
      // presentation response so the popup is exercised in both theme modes.
      await page.route('**/admin/api/user-configs/theme', async (route) => {
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        const body = await response.json();
        await route.fulfill({ response, json: { ...body, navTheme: scenario.theme } });
      });
      await login(page);
      await page.goto('/workplace');
      await expect(page.getByText(scenario.workplace, { exact: true })).toBeVisible();
      await expect(page.locator('html')).toHaveCSS(
        'color-scheme',
        scenario.theme === 'realDark' ? 'dark' : 'light',
      );

      const trigger = page.getByRole('button', { name: scenario.accountMenu });
      const headerContent = page.getByTestId('mss-thin-host-layout-header');
      const footerContent = page.getByTestId('mss-thin-host-layout-footer');
      await expect(headerContent).toBeVisible();
      await expect(headerContent).toHaveAttribute('data-current-user', ROOT_USERNAME);
      await expect(headerContent).toHaveAttribute(
        'data-compact',
        String(scenario.viewport.width === 390),
      );
      await expect(footerContent).toBeVisible();
      await expect(footerContent).toHaveAttribute('data-current-user', ROOT_USERNAME);
      await expect(footerContent).toHaveAttribute('data-compact', 'false');
      await expect(page.getByTestId('mss-thin-host-layout-permission')).toBeVisible();
      expect(await evaluatedContributions(page)).toEqual(
        expect.arrayContaining(['layout-self', 'layout-permission']),
      );
      await expect(
        page.getByRole('button', { name: scenario.menuSearch, exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: scenario.switchLanguage, exact: true }),
      ).toBeVisible();
      const coreFooter = page.locator('footer');
      await expect(coreFooter).toContainText('©');
      await expect(coreFooter.getByRole('link', { name: 'mss-boot-admin' })).toHaveAttribute(
        'href',
        'https://github.com/mss-boot-sys/mss-boot-admin',
      );
      const content = page.getByTestId('mss-thin-host-avatar');
      await expect(content).toHaveCount(0);
      expect(await evaluatedContributions(page)).not.toContain('avatar-self');
      expect(await evaluatedContributions(page)).not.toContain('avatar-permission');

      await trigger.focus();
      await page.keyboard.press('Enter');
      await expect(content).toBeVisible();
      await expect(content).toHaveAttribute('data-open', 'true');
      await expect(content.getByTestId('avatar-current-user')).toHaveText(ROOT_USERNAME);
      await expect(page.getByTestId('mss-thin-host-avatar-permission')).toBeVisible();
      expect(await evaluatedContributions(page)).toEqual(
        expect.arrayContaining(['avatar-self', 'avatar-permission']),
      );
      await expectNoDocumentOverflow(page);
      const bounds = await content.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(scenario.viewport.width);

      await content.getByLabel('Avatar note', { exact: true }).fill('An owned local note');
      await content.getByRole('button', { name: 'Apply note', exact: true }).click();
      await expect(content).toBeVisible();
      await expect(content.getByTestId('avatar-applied-note')).toHaveText('An owned local note');
      await content.getByRole('button', { name: 'Close custom panel', exact: true }).click();
      await expect(content).toHaveCount(0);
      await expect(trigger).toBeFocused();

      await trigger.click();
      await expect(content).toBeVisible();
      await expect(content.getByLabel('Avatar note', { exact: true })).toHaveValue('');
      await expect(content.getByTestId('avatar-applied-note')).toBeEmpty();
      await content.getByLabel('Avatar note', { exact: true }).focus();
      await page.keyboard.press('Escape');
      await expect(content).toHaveCount(0);
      await expect(trigger).toBeFocused();

      await trigger.click();
      await expect(content).toBeVisible();
      await page.getByText(scenario.workplace, { exact: true }).click();
      await expect(content).toHaveCount(0);

      for (const [label, path] of [
        [scenario.center, '/account/center'],
        [scenario.settings, '/account/settings'],
      ]) {
        await trigger.click();
        await expect(content).toBeVisible();
        await page
          .getByTestId('mss-avatar-panel')
          .getByRole('link', { name: label, exact: true })
          .click();
        await expect(page).toHaveURL(new RegExp(`${path}$`));
        await expect(content).toHaveCount(0);
      }

      await trigger.click();
      await expect(content).toBeVisible();
      // Authenticated custom content and core account navigation must stay clean.
      // Sign-out below intentionally revokes identity while protected requests settle.
      expect(consoleViolations).toEqual([]);
      await page
        .getByTestId('mss-avatar-panel')
        .getByRole('menu')
        .getByText(scenario.logout, { exact: true })
        .click();
      await expect(page).toHaveURL(/\/user\/login(?:\?|$)/);
      await expect(content).toHaveCount(0);
      await expect(headerContent).toHaveCount(0);
      await expect(footerContent).toHaveCount(0);
      const cookies = await page.context().cookies();
      expect(cookies.some((cookie) => cookie.name === 'mss_admin_session')).toBe(false);
      expect(cookies.some((cookie) => cookie.name === 'mss_csrf')).toBe(false);
      expect((await page.request.get(`${API_BASE_URL}/user/userInfo`)).status()).toBe(401);
    });
  }
}

import { randomUUID } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import { evaluatedContributions, trackContributionEvaluations } from './support/contributions';
import {
  API_BASE_URL,
  APP_BASE_URL,
  BACKEND_API_BASE_URL,
  csrfHeaders,
  login,
  readJSON,
  setLocale,
} from './support/session';

function menuContainsPath(value: unknown, expectedPath: string): boolean {
  if (!Array.isArray(value)) return false;
  return value.some((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const item = entry as Record<string, unknown>;
    return item.path === expectedPath || menuContainsPath(item.children, expectedPath);
  });
}

async function createRestrictedUser(rootPage: Page) {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
  const roleResponse = await rootPage.request.post(`${BACKEND_API_BASE_URL}/roles`, {
    data: {
      name: `e2e-restricted-${suffix}`,
      remark: 'E2E authorization boundary fixture',
      status: 'enabled',
    },
    headers: await csrfHeaders(rootPage),
  });
  expect(roleResponse.status()).toBe(201);
  const role = await readJSON(roleResponse);
  const roleID = typeof role.id === 'string' ? role.id : '';
  expect(roleID, 'the E2E fixture must create an ordinary restricted role').not.toBe('');

  const credentials = {
    username: `e2er${suffix}`,
    password: 'E2eRestricted123!',
  };
  const response = await rootPage.request.post(`${BACKEND_API_BASE_URL}/users`, {
    data: {
      email: `${credentials.username}@example.test`,
      name: 'E2E Finance',
      password: credentials.password,
      roleID,
      status: 'enabled',
      username: credentials.username,
    },
    headers: await csrfHeaders(rootPage),
  });
  expect(response.status()).toBe(201);
  const user = await readJSON(response);
  expect(typeof user.id === 'string' ? user.id : '').not.toBe('');
  return { credentials, userID: user.id as string, roleID };
}

test.describe('V6 authorization boundaries', () => {
  test('@permission user write boundaries keep the management list usable after creation', async ({
    page,
  }) => {
    await setLocale(page, 'en-US');
    await login(page);
    const username = `e2e_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
    const headers = await csrfHeaders(page);
    const invalid = await page.request.post(`${BACKEND_API_BASE_URL}/users`, {
      data: { username: `${username}x`, password: 'E2eUser123!' },
      headers,
    });
    expect(invalid.status()).toBe(422);
    const created = await page.request.post(`${BACKEND_API_BASE_URL}/users`, {
      data: { username, password: 'E2eUser123!', status: 'enabled' },
      headers,
    });
    expect(created.status()).toBe(201);
    const user = await readJSON(created);
    expect(typeof user.id).toBe('string');
    try {
      const invalidRename = await page.request.put(`${BACKEND_API_BASE_URL}/users/${user.id}`, {
        data: { username: `${username}x` },
        headers,
      });
      expect(invalidRename.status()).toBe(422);
      const listResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'GET' &&
          new URL(response.url()).pathname === '/admin/api/users',
      );
      await page.goto('/users');
      expect((await listResponse).status()).toBe(200);
      await expect(page.getByText(username, { exact: true })).toBeVisible();
      await expect(page.getByTestId('page-error')).toHaveCount(0);
      await expect(page.getByTestId('page-loading')).toHaveCount(0);
      await page.reload();
      await expect(page.getByText(username, { exact: true })).toBeVisible();
      await expect(page.getByTestId('page-error')).toHaveCount(0);
    } finally {
      const removed = await page.request.delete(`${BACKEND_API_BASE_URL}/users/${user.id}`, {
        headers: await csrfHeaders(page),
      });
      expect(removed.status()).toBe(204);
    }
  });

  test('@permission anonymous direct navigation requires a server session', async ({ page }) => {
    await setLocale(page, 'en-US');
    await page.goto('/suppliers');
    await expect(page.getByPlaceholder('Username')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByPlaceholder('Password')).toBeVisible();
    await expect(page).toHaveURL(/\/user\/login\?redirect=/);
  });

  test('@permission restricted user cannot access Supplier or online-session menu, route, and API', async ({
    browser,
    page,
  }) => {
    test.setTimeout(90_000);
    if (process.env.MSS_V6_AVATAR_PROBE === '1') {
      await trackContributionEvaluations(page);
    }
    const rootContext = await browser.newContext();
    const rootPage = await rootContext.newPage();
    await login(rootPage);
    const { credentials, userID, roleID } = await createRestrictedUser(rootPage);

    try {
      await setLocale(page, 'en-US');
      await login(page, credentials);

      const identity = await readJSON(await page.request.get(`${API_BASE_URL}/user/userInfo`));
      expect((identity.role as Record<string, unknown> | undefined)?.root).toBe(false);

      const menu = await page.request.get(`${API_BASE_URL}/menu/authorize`);
      const authorizedMenu = await menu.json();
      expect(menu.ok()).toBe(true);
      expect(menuContainsPath(authorizedMenu, '/suppliers')).toBe(false);
      expect(menuContainsPath(authorizedMenu, '/security/online-sessions')).toBe(false);

      await page.goto('/suppliers');
      await expect(page.getByText('403', { exact: true })).toBeVisible();
      expect(page.url().startsWith(APP_BASE_URL)).toBe(true);

      if (process.env.MSS_V6_AVATAR_PROBE === '1') {
        for (const position of ['header', 'footer']) {
          const layoutContent = page.getByTestId(`mss-thin-host-layout-${position}`);
          await expect(layoutContent).toBeVisible();
          await expect(layoutContent).toHaveAttribute('data-current-user', credentials.username);
        }
        await expect(page.getByTestId('mss-thin-host-layout-permission')).toHaveCount(0);
        expect(await evaluatedContributions(page)).toContain('layout-self');
        expect(await evaluatedContributions(page)).not.toContain('layout-permission');
        const selfContent = page.getByTestId('mss-thin-host-avatar');
        await expect(selfContent).toHaveCount(0);
        expect(await evaluatedContributions(page)).not.toContain('avatar-self');
        await page.getByRole('button', { name: /Open the account menu for / }).click();
        await expect(selfContent).toBeVisible();
        await expect(selfContent.getByTestId('avatar-current-user')).toHaveText(
          credentials.username,
        );
        await expect(page.getByTestId('mss-thin-host-avatar-permission')).toHaveCount(0);
        expect(await evaluatedContributions(page)).toContain('avatar-self');
        expect(await evaluatedContributions(page)).not.toContain('avatar-permission');
        await selfContent.getByRole('button', { name: 'Close custom panel', exact: true }).click();
        await expect(selfContent).toHaveCount(0);
      }

      const deniedList = await page.request.get(`${API_BASE_URL}/suppliers`);
      expect(deniedList.status()).toBe(403);

      const deniedCreate = await page.request.post(`${API_BASE_URL}/suppliers`, {
        data: {
          code: `DENIED_${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`,
          contactEmail: 'denied@example.test',
          contactName: 'Denied',
          country: 'CN',
          creditLevel: 'normal',
          enabled: true,
          name: 'Denied supplier',
        },
        headers: await csrfHeaders(page),
      });
      expect(deniedCreate.status()).toBe(403);

      const deniedSessions = await page.request.get(`${API_BASE_URL}/online-sessions`);
      expect(deniedSessions.status()).toBe(403);

      await page.goto('/security/online-sessions');
      await expect(page.getByText('403', { exact: true })).toBeVisible();
      expect(page.url().startsWith(APP_BASE_URL)).toBe(true);
    } finally {
      await page.close();
      try {
        const userRemoval = await rootPage.request.delete(
          `${BACKEND_API_BASE_URL}/users/${userID}`,
          {
            headers: await csrfHeaders(rootPage),
          },
        );
        expect(userRemoval.status()).toBe(204);
        const roleRemoval = await rootPage.request.delete(
          `${BACKEND_API_BASE_URL}/roles/${roleID}`,
          {
            headers: await csrfHeaders(rootPage),
          },
        );
        expect(roleRemoval.status()).toBe(204);
      } finally {
        await rootContext.close();
      }
    }
  });
});

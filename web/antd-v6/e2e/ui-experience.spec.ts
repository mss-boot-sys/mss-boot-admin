import { randomUUID } from 'node:crypto';
import { expect, type Page, type Route, test } from '@playwright/test';
import { API_BASE_URL, csrfHeaders, login, readJSON, setLocale } from './support/session';

// Route compilation and authenticated presentation loading can exceed the
// assertion default on a cold dev server. Wait on the actual usable surface.
test.setTimeout(60_000);

async function expectListReady(page: Page) {
  await expect(page.locator('#mss-admin-name-filter')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('page-loading')).toHaveCount(0);
  await expect(page.getByTestId('page-error')).toHaveCount(0);
}

interface FixtureUser {
  id: string;
  username: string;
  name: string;
}

async function withFixtureUser(page: Page, run: (user: FixtureUser) => Promise<void>) {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const username = `ui_${suffix}`;
  const name = `UI fixture ${suffix}`;
  const created = await page.request.post(`${API_BASE_URL}/users`, {
    data: {
      username,
      name,
      email: `${username}@example.test`,
      password: 'UiRegression123!',
      status: 'enabled',
    },
    headers: await csrfHeaders(page),
  });
  expect(created.status()).toBe(201);
  const body = await readJSON(created);
  if (typeof body.id !== 'string' || !body.id) throw new Error('fixture user has no ID');
  try {
    await run({ id: body.id, username, name });
  } finally {
    // page.request uses the real API even when a page route injects a failure.
    const removed = await page.request.delete(`${API_BASE_URL}/users/${body.id}`, {
      headers: await csrfHeaders(page),
    });
    expect([204, 404], 'remove only this test-created identity').toContain(removed.status());
  }
}

async function showFixtureUser(page: Page, user: FixtureUser) {
  await page.goto('/users');
  await expectListReady(page);
  const filter = page.locator('#mss-admin-name-filter');
  await filter.fill(user.name);
  const filtered = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === 'GET' &&
      url.pathname === '/admin/api/users' &&
      url.searchParams.get('name') === user.name
    );
  });
  await filter.press('Enter');
  expect((await filtered).status()).toBe(200);
  await expect(page.getByText(user.username, { exact: true })).toBeVisible();
  await expect(page.getByTestId('page-error')).toHaveCount(0);
}

function flattenMenus(nodes: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(nodes)) return [];
  return nodes.flatMap((node) =>
    node && typeof node === 'object'
      ? [node as Record<string, unknown>, ...flattenMenus(node.children)]
      : [],
  );
}

test('@ui-experience Chinese menu search finds an editable nested user menu', async ({
  page,
  isMobile,
}) => {
  await setLocale(page, 'zh-CN');
  await login(page);
  await page.goto('/menu');
  await expectListReady(page);
  const filter = page.locator('#mss-admin-name-filter');
  await filter.fill('用户管理');
  const filtered = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === 'GET' &&
      url.pathname === '/admin/api/menus' &&
      url.searchParams.get('name') === '用户管理'
    );
  });
  await filter.press('Enter');
  const response = await filtered;
  expect(response.status()).toBe(200);
  const keys = new URL(response.url()).searchParams.getAll('nameKeys[]');
  expect(keys).toContain('menu.origination.users');
  const body = (await response.json()) as { data?: unknown };
  const matched = flattenMenus(body.data).find((node) => node.path === '/users');
  expect(matched?.parentID).toBeTruthy();
  const row = page
    .getByRole(isMobile ? 'listitem' : 'row')
    .filter({ has: page.getByText('/users', { exact: true }) });
  for (let depth = 0; depth < 64 && !(await row.isVisible()); depth += 1) {
    const expand = page
      .getByRole('button', { name: isMobile ? /^展开 / : /^(展开行|Expand row)$/ })
      .first();
    if (!(await expand.count())) break;
    await expand.click();
  }
  await expect(row).toBeVisible();
  await expect(row.getByText('用户管理', { exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: '编辑', exact: true })).toBeEnabled();
  await expect(page.getByTestId('page-error')).toHaveCount(0);
});

test('@ui-experience desktop menu search restores keyboard focus on every opening', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Keyboard shortcut behavior is exercised once on the desktop project.');
  await setLocale(page, 'en-US');
  await login(page);
  await page.goto('/users');
  await expectListReady(page);
  const trigger = page.getByRole('button', { name: 'Open menu search', exact: true });
  const input = page.getByPlaceholder('Search accessible menus or paths');
  await trigger.focus();
  await page.keyboard.press('Control+k');
  await expect(input).toBeFocused();
  await input.fill('no_such_accessible_menu_123');
  await expect(page.getByText('No matching accessible menus', { exact: true })).toBeVisible();
  await input.press('Escape');
  await expect(input).toBeHidden();
  await expect(trigger).toBeFocused();

  await page.getByRole('heading', { level: 1 }).click();
  await page.keyboard.press('Control+k');
  await expect(input).toBeFocused();
  await input.fill('/app-config');
  await expect(page.getByRole('option').filter({ hasText: '/app-config' }).first()).toBeVisible();
  await input.press('Enter');
  await expect(page).toHaveURL(/\/app-config$/);
  await expect(input).toBeHidden();
});

test('@ui-experience desktop route tabs retain the settings query', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Route tabs are rendered only in the desktop side layout.');
  await setLocale(page, 'en-US');
  await login(page);
  await page.goto('/app-config?tab=theme');
  await expect(page.getByRole('tab', { name: 'Theme settings', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.goto('/users');
  const tabs = page.getByRole('navigation', { name: 'Open pages', exact: true });
  await tabs.getByRole('button', { name: 'Application settings', exact: true }).click();
  await expect(page).toHaveURL(/\/app-config\?tab=theme$/);
  await expect(page.getByRole('tab', { name: 'Theme settings', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('@ui-experience mobile user cards retain identity and expose batch actions', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'The desktop selection path is already covered by the shared table tests.');
  await setLocale(page, 'en-US');
  await login(page);
  await withFixtureUser(page, async (user) => {
    await showFixtureUser(page, user);
    const card = page
      .getByRole('listitem')
      .filter({ has: page.getByText(user.username, { exact: true }) });
    const settingsButton = page.getByRole('button', { name: 'Density · Columns', exact: true });
    await settingsButton.click();
    const settings = page.locator('.mss-table-settings');
    const identity = settings.getByRole('checkbox', { name: /^(Account|Username)$/ });
    await expect(identity).toBeChecked();
    await expect(identity).toBeDisabled();
    // Recreate the previous failure: hide every optional column except email.
    const checkboxes = settings.getByRole('checkbox');
    for (let index = 0; index < (await checkboxes.count()); index += 1) {
      const checkbox = checkboxes.nth(index);
      if (!(await checkbox.isEnabled())) continue;
      if (await checkbox.isChecked()) await checkbox.uncheck();
    }
    const email = settings.getByRole('checkbox', { name: 'Email', exact: true });
    if (await email.count()) await email.check();
    await settingsButton.click();
    await expect(card.getByText(user.username, { exact: true })).toBeVisible();
    await card
      .getByRole('checkbox', { name: `Select record ${user.username}`, exact: true })
      .check();
    const bulk = page.getByRole('toolbar', { name: 'Batch actions', exact: true });
    await expect(bulk).toBeVisible();
    await expect(bulk.getByText('1 selected', { exact: true })).toBeVisible();
    await bulk.getByRole('button', { name: 'Delete selected', exact: true }).click();
    const confirmation = page.getByRole('dialog', {
      name: 'Delete the 1 selected items?',
      exact: true,
    });
    await expect(confirmation).toBeVisible();
    await expect(confirmation.getByRole('button', { name: 'OK', exact: true })).toBeEnabled();
    await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(confirmation).toBeHidden();
    await bulk.getByRole('button', { name: 'Esc to cancel', exact: true }).click();
    await expect(bulk).toHaveCount(0);
    await page.reload();
    await expect(page.getByText(user.username, { exact: true })).toBeVisible();
    await expect(page.getByTestId('page-error')).toHaveCount(0);
  });
});

test('@ui-experience mobile navigation closes after changing pages and focuses content', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'The navigation drawer exists only in the mobile layout.');
  await setLocale(page, 'en-US');
  await login(page);
  await page.goto('/users');
  await page.getByRole('button', { name: 'Open primary navigation', exact: true }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await drawer.locator('a[href="/app-config"]').click();
  await expect(page).toHaveURL(/\/app-config$/);
  await expect(drawer).toBeHidden();
  await expect(
    page.getByRole('button', { name: 'Open primary navigation', exact: true }),
  ).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('main')).toBeFocused();
});

test('@ui-experience failed user deletion preserves confirmation and succeeds after retry', async ({
  page,
  isMobile,
}) => {
  await setLocale(page, 'en-US');
  await login(page);
  await withFixtureUser(page, async (user) => {
    await showFixtureUser(page, user);
    const row = page
      .getByRole(isMobile ? 'listitem' : 'row')
      .filter({ has: page.getByText(user.username, { exact: true }) });
    const url = `${API_BASE_URL}/users/${user.id}`;
    const rejectDelete = async (route: Route) => {
      if (route.request().method() !== 'DELETE') return route.continue();
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        json: { errorCode: 'USER_IN_USE', errorMessage: 'This fixture is temporarily in use' },
      });
    };
    await page.route(url, rejectDelete);
    try {
      await row.getByRole('button', { name: 'More actions', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
      const confirmation = page.getByRole('dialog', { name: 'Delete this user?', exact: true });
      const confirmButton = confirmation.getByRole('button').filter({ hasText: /^OK$/ });
      await expect(confirmation).toBeVisible();
      const rejected = page.waitForResponse(
        (response) => response.url() === url && response.request().method() === 'DELETE',
      );
      await confirmButton.click();
      expect((await rejected).status()).toBe(409);
      await expect(page.getByText(/Deletion failed:.*temporarily in use/)).toBeVisible();
      await expect(confirmation).toBeVisible();
      // The mutation's toast precedes RowActions' promise rejection handler.
      const failure = confirmation.getByRole('alert');
      await expect(
        failure.getByText('This fixture is temporarily in use', { exact: true }),
      ).toBeVisible();
      // AntD's zero-width exit-motion icon can retain the accessible name
      // "loading" after pending ends. Check the actual button state and retry.
      await expect(confirmButton).not.toHaveClass(/(?:^|\s)ant-btn-loading(?:\s|$)/);
      await expect(confirmButton).toBeEnabled();
      expect((await page.request.get(url)).status()).toBe(200);

      await page.unroute(url, rejectDelete);
      const deleted = page.waitForResponse(
        (response) => response.url() === url && response.request().method() === 'DELETE',
      );
      await confirmButton.click();
      expect((await deleted).status()).toBe(204);
      await expect(confirmation).toBeHidden();
      await expect(page.getByText(user.username, { exact: true })).toHaveCount(0);
      expect((await page.request.get(url)).status()).toBe(404);
    } finally {
      await page.unroute(url, rejectDelete);
    }
  });
});

import { expect, test } from '@playwright/test';
import { expectNoDocumentOverflow, login, setLocale } from './support/session';

// This is browser UI evidence with explicit management API fixtures. Protocol,
// database and RBAC behavior are separately exercised by admin/oidc tests.
// Never retain secret-bearing dialogs in screenshots or traces.
test.use({ trace: 'off', screenshot: 'off' });
test('@sso application registration, secret rotation, disable and audit', async ({ page }) => {
  await setLocale(page, 'en-US');
  await login(page);
  let client: Record<string, unknown> | undefined;
  let displayedSecret = 'fixture-only-secret-value';
  await page.route('**/admin/api/sso/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    let data: unknown;
    let status = 200;
    if (url.pathname.endsWith('/audit')) {
      data = {
        list: [
          {
            id: 'audit-fixture',
            userID: 'operator',
            action: 'oidc.client.update',
            resource: 'fixture-client',
            status: 'enabled',
            createdAt: '2026-10-10T00:00:00Z',
          },
        ],
        total: 1,
      };
    } else if (request.method() === 'GET') {
      data = {
        list: client ? [client] : [],
        total: client ? 1 : 0,
        issuer: 'https://identity.example.test/admin/api/oidc',
      };
    } else if (url.pathname.endsWith('/rotate-secret')) {
      displayedSecret = 'fixture-only-rotated-value';
      if (client) client.revision = Number(client.revision) + 1;
      data = { secret: displayedSecret };
    } else if (request.method() === 'POST') {
      client = { ...request.postDataJSON(), id: 'fixture-client', revision: 1 };
      data = { client, secret: displayedSecret };
      status = 201;
    } else {
      client = {
        ...request.postDataJSON(),
        id: 'fixture-client',
        revision: Number(client?.revision) + 1,
      };
    }
    await route.fulfill({ status, json: { success: true, data } });
  });
  await page.goto('/sso');
  await expect(page.getByText('No applications registered')).toBeVisible();
  await page.getByRole('button', { name: 'Register application' }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Name', { exact: true }).fill('PVE test cluster');
  await form.getByLabel('Exact redirect URIs').fill('https://pve.example.test:8006');
  await form.getByLabel('Exact redirect URIs').press('Enter');
  await form.getByLabel('Allowed user IDs').fill('account-id');
  await form.getByLabel('Allowed user IDs').press('Enter');
  await form.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(page.getByRole('dialog').getByText(displayedSecret, { exact: true })).toBeVisible();
  await page
    .getByRole('dialog', { name: 'Save this client secret' })
    .getByRole('button', { name: 'Close', exact: true })
    .last()
    .click();
  await expect(page.getByText(displayedSecret, { exact: true })).toHaveCount(0);
  await expect(page.getByText('PVE test cluster', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Rotate secret', exact: true }).click();
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(page.getByText('fixture-only-rotated-value', { exact: true })).toBeVisible();
  await page
    .getByRole('dialog', { name: 'Save this client secret' })
    .getByRole('button', { name: 'Close', exact: true })
    .last()
    .click();
  await page.getByRole('button', { name: 'Edit application' }).click();
  await page.getByRole('dialog').getByRole('switch').click();
  await page.getByRole('dialog').getByRole('button', { name: 'OK', exact: true }).click();
  await expect(page.getByText('Disabled', { exact: true })).toBeVisible();
  expect(client?.enabled).toBe(false);
  await page.getByRole('tab', { name: 'Authorization audit' }).click();
  await expect(page.getByText('oidc.client.update')).toBeVisible();
  await expectNoDocumentOverflow(page);
});

test('@sso unknown unavailable service remains retryable and consent is explicit', async ({
  page,
}) => {
  await setLocale(page, 'en-US');
  await login(page);
  await page.route('**/admin/api/sso/clients**', (route) =>
    route.fulfill({ status: 404, json: {} }),
  );
  await page.goto('/sso');
  await expect(page.getByText('Unable to load SSO data. Please try again.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await expect(page.getByText('SSO is not configured', { exact: true })).toHaveCount(0);
  await page.route('**/admin/api/oidc/interaction**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        json: {
          name: 'PVE test cluster',
          scopes: ['openid', 'profile'],
          claims: ['preferred_username'],
        },
      });
    } else {
      expect(route.request().headers()['x-csrf-token']).toBeTruthy();
      expect(route.request().postDataJSON().approve).toBe(false);
      await route.fulfill({
        json: { redirect: 'https://pve.example.test:8006/?error=access_denied' },
      });
    }
  });
  await page.route('https://pve.example.test:8006/**', (route) =>
    route.fulfill({ body: 'Relying party received denial' }),
  );
  await page.goto('/user/oidc?request=fixture-handle');
  await expect(page.getByText('PVE test cluster')).toBeVisible();
  await page.getByRole('button', { name: 'Deny', exact: true }).click();
  await expect(page).toHaveURL(/error=access_denied/);
});

test('@sso explicitly disabled provider explains configuration without retry controls', async ({
  page,
}) => {
  await setLocale(page, 'en-US');
  await login(page);
  let requests = 0;
  await page.route('**/admin/api/sso/clients**', async (route) => {
    requests += 1;
    await route.fulfill({
      status: 503,
      json: { errorCode: 'SSO_PROVIDER_DISABLED' },
    });
  });
  await page.goto('/sso');
  await expect(page.getByText('SSO is not configured', { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      'The SSO provider is not enabled in this environment. Contact your administrator to configure it.',
    ),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  await expect(page.getByText('Unable to load SSO data. Please try again.')).toHaveCount(0);
  expect(requests).toBe(1);
  await expectNoDocumentOverflow(page);
});

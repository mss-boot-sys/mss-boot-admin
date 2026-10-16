import { randomUUID } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import {
  API_BASE_URL,
  csrfHeaders,
  expectNoDocumentOverflow,
  login,
  readJSON,
  setLocale,
} from './support/session';

interface Capability {
  pageKey: string;
  definitionHash: string;
  defaultPresentation: {
    list?: { columns?: Array<{ field?: string; order?: number }> };
    search?: { fields?: Array<{ field?: string; order?: number }> };
  };
}

interface Profile {
  id: string;
  pageKey: string;
  scope: string;
  version: number;
}

const pages = [
  { pageKey: 'user.list', route: '/users' },
  { pageKey: 'role.list', route: '/role' },
  { pageKey: 'menu.list', route: '/menu' },
  { pageKey: 'department.list', route: '/departments' },
  { pageKey: 'post.list', route: '/posts' },
  { pageKey: 'task.list', route: '/task' },
  { pageKey: 'notice.list', route: '/notice' },
  { pageKey: 'language.list', route: '/language' },
  { pageKey: 'option.list', route: '/option' },
  { pageKey: 'system-config.list', route: '/system-config' },
  { pageKey: 'online-session.list', route: '/security/online-sessions' },
  { pageKey: 'log.login', route: '/log' },
  { pageKey: 'log.audit', route: '/log' },
  { pageKey: 'log.runtime', route: '/log' },
] as const;

const listEndpoints: Readonly<Record<string, string>> = {
  'user.list': '/users',
  'role.list': '/roles',
  'menu.list': '/menus',
  'department.list': '/departments',
  'post.list': '/posts',
  'task.list': '/tasks',
  'notice.list': '/notices',
  'language.list': '/languages',
  'option.list': '/options',
  'system-config.list': '/system-configs',
  'online-session.list': '/online-sessions',
  'log.login': '/audit-logs/login',
  'log.audit': '/audit-logs/operation',
  'log.runtime': '/logs',
};

async function waitForListResponse(page: Page, pageKey: string) {
  const response = await page.waitForResponse(
    (candidate) =>
      candidate.request().method() === 'GET' &&
      new URL(candidate.url()).pathname === `/admin/api${listEndpoints[pageKey]}`,
  );
  expect(response.status(), `actual list response ${pageKey}`).toBe(200);
}

async function expectUsableList(page: Page) {
  // A published title is outside the list's loading/error boundary. Require
  // rendered data or a confirmed empty state so parser failures cannot pass.
  await expect(
    page
      .locator('section.mss-surface')
      .filter({ has: page.locator('table, ul, [data-testid="page-empty"]') })
      .first(),
  ).toBeVisible();
  await expect(page.getByTestId('page-loading')).toHaveCount(0);
  await expect(page.getByTestId('page-error')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
}

function unwrapData<T>(body: Record<string, unknown>): T {
  return ('data' in body ? body.data : body) as T;
}

function profileETag(profile: Profile): string {
  return JSON.stringify(`presentation-profile-${profile.id}-${profile.version}`);
}

function firstField(
  capability: Capability,
  surface: 'list' | 'search',
): { field: string; order?: number } | undefined {
  const candidate =
    surface === 'list'
      ? capability.defaultPresentation.list?.columns?.[0]
      : capability.defaultPresentation.search?.fields?.[0];
  if (!candidate?.field) {
    return undefined;
  }
  return {
    field: candidate.field,
    ...(typeof candidate.order === 'number' ? { order: candidate.order } : {}),
  };
}

function presentationDocument(capability: Capability, title: string) {
  const listField = firstField(capability, 'list');
  const searchField = firstField(capability, 'search');
  if (!listField) throw new Error(`${capability.pageKey} has no compiled list field`);
  return {
    apiVersion: 'mss.io/v1alpha1',
    kind: 'AdminPagePresentation',
    metadata: {
      name: `e2e-${capability.pageKey.replaceAll('.', '-')}-application`,
      pageKey: capability.pageKey,
      definitionHash: capability.definitionHash,
      scope: { kind: 'application' },
    },
    spec: {
      title: { 'en-US': title, 'zh-CN': `验收 ${capability.pageKey}` },
      list: {
        columns: [{ ...listField, hidden: false }],
        density: 'compact',
        pageSize: 20,
      },
      ...(searchField
        ? {
            search: {
              collapsedByDefault: false,
              fields: [{ ...searchField, hidden: false }],
            },
          }
        : {}),
    },
  };
}

async function updateOrCreateDraft(
  page: Page,
  capability: Capability,
  profiles: Profile[],
  title: string,
): Promise<Profile> {
  const headers = await csrfHeaders(page);
  const document = presentationDocument(capability, title);
  const summary = profiles.find(
    (profile) => profile.pageKey === capability.pageKey && profile.scope === 'application',
  );

  if (!summary) {
    const response = await page.request.post(`${API_BASE_URL}/presentation-profiles`, {
      data: { scope: 'application', pageKey: capability.pageKey, document },
      headers: { ...headers, 'If-None-Match': '*' },
    });
    expect(response.status(), `create ${capability.pageKey} draft`).toBe(201);
    return (await readJSON(response)) as unknown as Profile;
  }

  const currentResponse = await page.request.get(
    `${API_BASE_URL}/presentation-profiles/${encodeURIComponent(summary.id)}`,
  );
  const current = unwrapData<Profile>(await readJSON(currentResponse));
  const response = await page.request.put(
    `${API_BASE_URL}/presentation-profiles/${encodeURIComponent(current.id)}/draft`,
    {
      data: { document },
      headers: { ...headers, 'If-Match': profileETag(current) },
    },
  );
  expect(response.status(), `replace ${capability.pageKey} draft`).toBe(200);
  return unwrapData<Profile>(await readJSON(response));
}

async function publishDraft(page: Page, profile: Profile): Promise<Profile> {
  const headers = await csrfHeaders(page);
  const response = await page.request.post(
    `${API_BASE_URL}/presentation-profiles/${encodeURIComponent(profile.id)}/publish`,
    {
      headers: {
        ...headers,
        'Idempotency-Key': `e2e-publish:${randomUUID()}`,
        'If-Match': profileETag(profile),
      },
    },
  );
  expect(response.status(), `publish ${profile.pageKey}`).toBe(200);
  const transition = (await readJSON(response)) as unknown as { profile: Profile };
  return transition.profile;
}

async function readCapabilities(page: Page): Promise<Capability[]> {
  const response = await page.request.get(`${API_BASE_URL}/presentation-capabilities`);
  const catalog = unwrapData<{ items: Capability[]; activePages: string[] }>(
    await readJSON(response),
  );
  expect([...catalog.activePages].sort()).toEqual(pages.map(({ pageKey }) => pageKey).sort());
  expect(catalog.items.map(({ pageKey }) => pageKey)).toEqual(
    expect.arrayContaining(pages.map(({ pageKey }) => pageKey)),
  );
  expect(catalog.activePages).not.toContain('supplier.list');
  return catalog.items;
}

async function readProfiles(page: Page): Promise<Profile[]> {
  const response = await page.request.get(
    `${API_BASE_URL}/presentation-profiles?page=1&pageSize=100`,
  );
  return unwrapData<{ items: Profile[] }>(await readJSON(response)).items;
}

async function expectConfiguredPage(
  page: Page,
  route: string,
  titles: ReadonlyMap<string, string>,
  pageKeys: readonly string[],
) {
  const expectPublishedPage = async (navigate: () => Promise<unknown>) => {
    // Document load can precede route compilation and authenticated profile
    // requests in the dev server. Check that boundary before asserting render.
    const profiles = pageKeys.map(async (pageKey) => {
      const response = await page.waitForResponse(
        (candidate) =>
          candidate.request().method() === 'GET' &&
          new URL(candidate.url()).pathname ===
            `/admin/api/presentation/effective/${encodeURIComponent(pageKey)}`,
      );
      expect(response.status(), `effective profile ${pageKey}`).toBe(200);
    });
    const initialPageKey = pageKeys[0];
    if (!initialPageKey) throw new Error('configured route has no page key');
    const list = waitForListResponse(page, initialPageKey);
    await Promise.all([navigate(), list, ...profiles]);
    for (const pageKey of pageKeys) {
      const title = titles.get(pageKey);
      if (!title) throw new Error(`missing configured title for ${pageKey}`);
      await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
    }
    await expectUsableList(page);
    // Log profiles share one route, but each tab has its own data contract.
    for (const pageKey of pageKeys.slice(1)) {
      await Promise.all([
        waitForListResponse(page, pageKey),
        page.getByRole('tab', { name: titles.get(pageKey), exact: true }).click(),
      ]);
      await expectUsableList(page);
    }
    await expectNoDocumentOverflow(page);
  };

  await expectPublishedPage(() => page.goto(route));
  await expectPublishedPage(() => page.reload());
}

test('@presentation all built-in management pages consume published runtime profiles after reload', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
  const consoleViolations: string[] = [];
  const responseViolations: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') {
      consoleViolations.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('response', (response) => {
    if (response.status() >= 400 && response.url().includes('/admin/api/')) {
      responseViolations.push(
        `${response.status()} ${response.request().method()} ${response.url()}`,
      );
    }
  });

  await setLocale(page, 'en-US');
  await login(page);
  const capabilities = await readCapabilities(page);
  const existingProfiles = await readProfiles(page);
  const titles = new Map<string, string>();

  for (const expected of pages) {
    const capability = capabilities.find(({ pageKey }) => pageKey === expected.pageKey);
    expect(capability, `registered capability ${expected.pageKey}`).toBeDefined();
    if (!capability) throw new Error(`missing registered capability ${expected.pageKey}`);
    const title = `E2E ${expected.pageKey} ${suffix}`;
    titles.set(expected.pageKey, title);
    const draft = await updateOrCreateDraft(page, capability, existingProfiles, title);
    await publishDraft(page, draft);
  }

  for (const current of pages.filter(({ route }) => route !== '/log')) {
    await expectConfiguredPage(page, current.route, titles, [current.pageKey]);
  }
  await expectConfiguredPage(
    page,
    '/log',
    titles,
    pages.filter(({ route }) => route === '/log').map(({ pageKey }) => pageKey),
  );

  expect(responseViolations).toEqual([]);
  expect(consoleViolations).toEqual([]);
});

import { describe, expect, it } from 'vitest';

type Route = { path?: string; layout?: boolean; component?: string; routes?: Route[] };
type Configuration = { routes: Route[]; proxy: Record<string, unknown> } & Record<string, unknown>;

const { defineBusinessAdmin } = require('../package/business.cjs') as {
  defineBusinessAdmin: (options?: Record<string, unknown>) => Configuration;
};

const portal = {
  surface: 'portal',
  routes: [
    { path: '/portal/home', component: '@/extensions/portal/Home' },
    { path: '/portal/orders', component: '@/extensions/portal/Orders' },
  ],
};

describe('defineBusinessAdmin extensions (v1.6.0)', () => {
  it('leaves the configuration unchanged when no extension is registered', () => {
    const baseline = JSON.stringify(defineBusinessAdmin({ title: 't' }));
    expect(JSON.stringify(defineBusinessAdmin({ title: 't', extensions: [] }))).toBe(baseline);
    expect(JSON.stringify(defineBusinessAdmin({ title: 't', extensions: undefined }))).toBe(
      baseline,
    );
  });

  it('mounts extension pages under the surface prefix before the fallbacks', () => {
    const configuration = defineBusinessAdmin({ extensions: [portal] });
    const paths = configuration.routes.map((route) => route.path);
    const mount = configuration.routes.find((route) => route.path === '/portal');
    expect(mount).toMatchObject({ layout: false });
    expect(mount?.routes?.map((route) => route.path)).toEqual(['/portal/home', '/portal/orders']);
    expect(paths.indexOf('/portal')).toBeLessThan(paths.indexOf('/403'));
    expect(paths.slice(-3)).toEqual(['/403', '/', '/*']);
    expect(paths).toContain('/workplace');
  });

  it('accepts an extension-owned layout module', () => {
    const configuration = defineBusinessAdmin({
      extensions: [{ ...portal, layout: '@/extensions/portal/Layout' }],
    });
    expect(configuration.routes.find((route) => route.path === '/portal')).toMatchObject({
      layout: false,
      component: '@/extensions/portal/Layout',
    });
  });

  it('cannot replace or escape into Admin routes', () => {
    const bad: Array<[unknown, string]> = [
      [{}, 'extensions must be an array'],
      [[{ ...portal, surface: 'admin' }], 'reserved'],
      [[{ ...portal, surface: 'user' }], 'reserved'],
      [[{ ...portal, surface: 'Portal' }], 'surface must match'],
      [[{ surface: 'portal', routes: [{ path: '/users' }] }], 'must stay below /portal'],
      [[{ surface: 'portal', routes: [{ path: '/portalx' }] }], 'must stay below /portal'],
      [[{ surface: 'portal', routes: [{ path: '/portal/api/x' }] }], 'overlaps its API'],
      [[{ surface: 'portal', routes: [] }], 'non-empty array'],
      [[portal, portal], 'duplicate'],
      [[{ ...portal, request: './my-request' }], 'unsupported option: request'],
      [[{ ...portal, layout: true }], 'layout must be false'],
    ];
    for (const [extensions, message] of bad) {
      expect(() => defineBusinessAdmin({ extensions })).toThrow(message);
    }
    expect(() =>
      defineBusinessAdmin({
        businessRoutes: [{ path: '/portal', component: '@/business/portal' }],
        extensions: [portal],
      }),
    ).toThrow();
  });
});

const { existsSync, readFileSync } = require('node:fs');
const { isAbsolute, relative, resolve, sep } = require('node:path');
const RuntimeStatsPlugin = require('./runtime-stats-plugin.cjs');
const { createAdminRoutes } = require('./core-routes.cjs');

const packageRoot = resolve(__dirname, '..');
const packageSourceRoot = resolve(packageRoot, 'src');
const packageManifest = require('../package.json');
const emptyRegistrations = resolve(__dirname, 'empty-route-registrations.ts');
const emptyWorkplace = resolve(__dirname, 'empty-workplace.ts');
const emptyAvatar = resolve(__dirname, 'empty-avatar.ts');
const emptyLayout = resolve(__dirname, 'empty-layout.ts');
const environment = process.env.UMI_ENV || 'dev';
const browserQualification = process.env.MSS_V6_E2E === '1';

function isPathInside(root, target) {
  const relativePath = relative(root, target);
  return (
    relativePath === '' ||
    (relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
  );
}

function isThirdPartyVendorModule(module) {
  const resource =
    typeof module?.nameForCondition === 'function' ? module.nameForCondition() : module?.resource;
  return (
    typeof resource === 'string' &&
    /[\\/]node_modules[\\/]/.test(resource) &&
    !isPathInside(packageSourceRoot, resource)
  );
}

function logoDataURL() {
  const logo = readFileSync(resolve(packageRoot, 'public/logo.svg'), 'utf8');
  return `data:image/svg+xml,${encodeURIComponent(logo)}`;
}

function proxyConfig(apiTarget, surfacePrefixes = []) {
  if (environment === 'release') return {};
  const proxy = {
    '/admin/': {
      target: apiTarget,
      changeOrigin: false,
      secure: false,
    },
  };
  for (const prefix of surfacePrefixes) {
    proxy[`${prefix}/api/`] = { target: apiTarget, changeOrigin: false, secure: false };
  }
  return proxy;
}

function validateBusinessAdminOptions(options) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Admin Web options must be an object.');
  }
  if ('routes' in options) {
    throw new Error(
      'Admin core routes are immutable; extend the complete application with businessRoutes instead of routes.',
    );
  }
  if (options.businessRoutes !== undefined && !Array.isArray(options.businessRoutes)) {
    throw new TypeError('Admin Web businessRoutes must be an array.');
  }
  if (
    options.workplaceContributions !== undefined &&
    (typeof options.workplaceContributions !== 'string' || !options.workplaceContributions.trim())
  ) {
    throw new TypeError('workplaceContributions must name a compile-time module.');
  }
  if (
    options.avatarContributions !== undefined &&
    (typeof options.avatarContributions !== 'string' || !options.avatarContributions.trim())
  ) {
    throw new TypeError('avatarContributions must name a compile-time module.');
  }
  if (
    options.layoutContributions !== undefined &&
    (typeof options.layoutContributions !== 'string' || !options.layoutContributions.trim())
  ) {
    throw new TypeError('layoutContributions must name a compile-time module.');
  }
}

const extensionSurfacePattern = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/;
// Mirrors reservedSurfaceNames in admin/business/surface.go (names that cannot
// match the surface pattern, such as .well-known, are omitted). Keep in sync.
const reservedExtensionSurfaces = new Set([
  'admin',
  'api',
  'oidc',
  'swagger',
  'static',
  'assets',
  'public',
  'docs',
  'ws',
  'healthz',
  'readyz',
  'metrics',
  'user',
  'users',
  'workplace',
]);
const extensionKeys = new Set(['surface', 'routes', 'layout']);

function routeTreePaths(routes) {
  return routes.flatMap((route) => [
    ...(typeof route.path === 'string' ? [route.path] : []),
    ...(Array.isArray(route.routes) ? routeTreePaths(route.routes) : []),
  ]);
}

// Extensions (v1.6.0) mount a module's pages under its own surface prefix in
// the single Admin SPA. They cannot replace Admin routes, layout or runtime;
// see docs/adr/2026-10-14-admin-web-extensions-mount-point.md.
function extensionRoutes(extensions) {
  if (extensions === undefined) return [];
  if (!Array.isArray(extensions)) {
    throw new TypeError('Admin Web extensions must be an array.');
  }
  const surfaces = new Set();
  return extensions.map((extension, index) => {
    if (extension === null || typeof extension !== 'object' || Array.isArray(extension)) {
      throw new TypeError(`Admin Web extension ${index} must be an object.`);
    }
    for (const key of Object.keys(extension)) {
      if (!extensionKeys.has(key)) {
        throw new Error(`Admin Web extension ${index} has unsupported option: ${key}`);
      }
    }
    const { surface, routes, layout } = extension;
    if (typeof surface !== 'string' || !extensionSurfacePattern.test(surface)) {
      throw new TypeError(
        `Admin Web extension ${index} surface must match ${extensionSurfacePattern}`,
      );
    }
    if (reservedExtensionSurfaces.has(surface)) {
      throw new Error(`Admin Web extension surface is reserved: ${surface}`);
    }
    if (surfaces.has(surface)) {
      throw new Error(`duplicate Admin Web extension surface: ${surface}`);
    }
    surfaces.add(surface);
    if (!Array.isArray(routes) || routes.length === 0) {
      throw new TypeError(`Admin Web extension ${surface} routes must be a non-empty array.`);
    }
    const prefix = `/${surface}`;
    for (const routePath of routeTreePaths(routes)) {
      if (routePath !== prefix && !routePath.startsWith(`${prefix}/`)) {
        throw new Error(
          `Admin Web extension ${surface} route must stay below ${prefix}: ${routePath}`,
        );
      }
      if (routePath.split('/').some((segment) => segment === '..' || segment === '.')) {
        throw new Error(
          `Admin Web extension ${surface} route must not contain . or .. segments: ${routePath}`,
        );
      }
      if (routePath === `${prefix}/api` || routePath.startsWith(`${prefix}/api/`)) {
        throw new Error(`Admin Web extension ${surface} route overlaps its API: ${routePath}`);
      }
    }
    if (
      layout !== undefined &&
      layout !== false &&
      (typeof layout !== 'string' || !layout.trim())
    ) {
      throw new TypeError(
        `Admin Web extension ${surface} layout must be false or a compile-time module.`,
      );
    }
    const mount = { path: prefix, layout: false, routes };
    if (typeof layout === 'string') {
      mount.component = layout;
    }
    return mount;
  });
}

function defineBusinessAdmin(options = {}) {
  validateBusinessAdminOptions(options);
  const extensions = extensionRoutes(options.extensions);
  const title = options.title || 'mss-boot-io';
  const logo = logoDataURL();
  const tailwindStyles = require.resolve('tailwindcss/index.css');
  const tailwindPostCSS = require.resolve('@tailwindcss/postcss');
  const apiTarget =
    options.apiTarget || process.env.MSS_ADMIN_API_TARGET || 'http://127.0.0.1:8080';
  const routeRegistrations = options.routeRegistrations
    ? resolve(process.cwd(), options.routeRegistrations)
    : emptyRegistrations;
  const routes = createAdminRoutes({
    businessRoutes: [...(options.businessRoutes || []), ...extensions],
    pagesRoot: resolve(packageRoot, 'src/pages'),
  });
  const ownedWorkplace = resolve(process.cwd(), 'src/business/workplace.ts');
  const workplaceContributions = options.workplaceContributions
    ? resolve(process.cwd(), options.workplaceContributions)
    : existsSync(ownedWorkplace)
      ? ownedWorkplace
      : emptyWorkplace;
  const ownedAvatar = resolve(process.cwd(), 'src/business/avatar.ts');
  const avatarContributions = options.avatarContributions
    ? resolve(process.cwd(), options.avatarContributions)
    : existsSync(ownedAvatar)
      ? ownedAvatar
      : emptyAvatar;
  const ownedLayout = resolve(process.cwd(), 'src/business/layout.ts');
  const layoutContributions = options.layoutContributions
    ? resolve(process.cwd(), options.layoutContributions)
    : existsSync(ownedLayout)
      ? ownedLayout
      : emptyLayout;
  const hasPostCSSConfig = ['postcss.config.cjs', 'postcss.config.js', 'postcss.config.mjs'].some(
    (name) => existsSync(resolve(process.cwd(), name)),
  );
  const useUtoopack = options.useUtoopack === true && environment !== 'release';

  return {
    presets: [require.resolve('./mssAdminPreset.cjs')],
    mssAdmin: {
      packageRoot,
      routeRegistrations,
      workplaceContributions,
      avatarContributions,
      layoutContributions,
    },
    alias: {
      '@mss-admin-core': resolve(packageRoot, 'src'),
      '@mss-admin-business/routes': routeRegistrations,
      '@mss-admin-business/workplace': workplaceContributions,
      '@mss-admin-business/avatar': avatarContributions,
      '@mss-admin-business/layout': layoutContributions,
      '@root': packageRoot,
      tailwindcss: tailwindStyles,
    },
    antd: {
      appConfig: {},
      configProvider: {
        componentSize: 'middle',
        focusOutline: true,
        variant: 'filled',
        theme: {
          cssVar: { prefix: 'mss' },
          token: {
            colorPrimary: '#1677ff',
            borderRadius: 8,
            fontFamily:
              "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          },
        },
      },
    },
    codeSplitting: { jsStrategy: 'granularChunks' },
    chainWebpack(memo) {
      if (environment !== 'release') return memo;

      // CPU-based minifier defaults give each worker an independent V8 heap.
      for (const minimizer of ['js-terser', 'css-esbuild']) {
        if (memo.optimization.minimizers.has(minimizer)) {
          memo.optimization.minimizer(minimizer).tap((args) => {
            args[0] = { ...args[0], parallel: 2 };
            return args;
          });
        }
      }

      memo.plugin('runtime-graph-stats').use(RuntimeStatsPlugin);
      memo.optimization.runtimeChunk({ name: 'runtime' });
      memo.optimization.splitChunks({
        cacheGroups: {
          antDesignRuntime: {
            chunks: 'all',
            enforce: true,
            name: 'ant-design-runtime',
            priority: 35,
            test: /[\\/]node_modules[\\/]@ant-design[\\/]/,
          },
          antdRuntime: {
            chunks: 'all',
            enforce: true,
            name: 'antd-runtime',
            priority: 35,
            test: /[\\/]node_modules[\\/]antd[\\/]/,
          },
          applicationShell: {
            chunks: 'all',
            enforce: true,
            name: 'application-shell',
            priority: 34,
            test: /[\\/]src[\\/](?:modules[\\/]language|shared)[\\/]/,
          },
          productLocales: {
            chunks: 'all',
            enforce: true,
            name: 'product-locales',
            priority: 34,
            test: /[\\/](?:package[\\/]locales|src[\\/](?:locales|generated[\\/]locales))[\\/]/,
          },
          proComponents: {
            chunks: 'all',
            enforce: true,
            name: 'pro-components',
            priority: 36,
            test: /[\\/]node_modules[\\/]@ant-design[\\/]pro-/,
          },
          queryRuntime: {
            chunks: 'all',
            enforce: true,
            name: 'query-runtime',
            priority: 32,
            test: /[\\/]node_modules[\\/](?:@tanstack|axios|ahooks)[\\/]/,
          },
          umiRuntime: {
            chunks: 'all',
            enforce: true,
            name: 'umi-runtime',
            priority: 33,
            test: /(?:[\\/]src[\\/]\.umi-production[\\/]|[\\/]node_modules[\\/](?:@umijs|umi)[\\/])/,
          },
          rcRuntime: {
            chunks: 'all',
            enforce: true,
            name: 'rc-runtime',
            priority: 35,
            test: /[\\/]node_modules[\\/](?:@rc-component|rc-[^\\/]+)[\\/]/,
          },
          vendors: {
            chunks: 'all',
            enforce: true,
            name: 'vendors',
            priority: 20,
            test: isThirdPartyVendorModule,
          },
        },
      });
      return memo;
    },
    access: {},
    define: {
      __APP_VERSION__: packageManifest.version,
      __ANTD_VERSION__: require('antd/package.json').version,
    },
    exportStatic: {},
    esbuildMinifyIIFE: true,
    extraBabelIncludes: [resolve(packageRoot, 'src')],
    extraPostCSSPlugins: hasPostCSSConfig ? [] : [require('@tailwindcss/postcss')],
    favicons: [logo],
    fastRefresh: true,
    hash: true,
    history: { type: 'browser' },
    initialState: {},
    jsMinifier: environment === 'release' ? 'terser' : 'esbuild',
    locale: {
      antd: true,
      baseNavigator: true,
      default: 'zh-CN',
      title: true,
    },
    layout: {
      locale: true,
      navTheme: 'light',
      colorPrimary: '#3b5bfd',
      layout: 'side',
      contentWidth: 'Fluid',
      fixedHeader: true,
      fixSiderbar: true,
      colorWeak: false,
      title,
      logo,
      splitMenus: false,
    },
    manifest: {},
    mfsu: false,
    model: {},
    moment2dayjs: {
      preset: 'antd',
      plugins: ['duration', 'relativeTime'],
    },
    npmClient: 'pnpm',
    polyfill: { imports: [] },
    proxy: proxyConfig(
      apiTarget,
      extensions.map((extension) => extension.path),
    ),
    reactQuery: { queryClient: false },
    request: {},
    routePrefetch: {},
    routes,
    targets: {
      chrome: 120,
      edge: 120,
      firefox: 121,
      safari: '17.4',
    },
    title,
    utoopack: useUtoopack
      ? {
          persistentCaching: !browserQualification,
          optimization: {
            splitChunks: {
              js: {
                maxChunkCountPerGroup: 40,
                maxMergeChunkSize: 200_000,
                minChunkSize: 50_000,
              },
            },
          },
          resolve: {
            alias: {
              d: resolve(packageRoot, 'src/shims/d.cjs'),
              'd/auto-bind': require.resolve('d/auto-bind'),
              tailwindcss: tailwindStyles,
            },
          },
          styles: {
            postcss: {
              plugins: {
                [tailwindPostCSS]: {},
              },
            },
          },
        }
      : false,
  };
}

module.exports = {
  defineBusinessAdmin,
};

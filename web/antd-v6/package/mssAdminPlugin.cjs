// Keep a unique basename: Umi uses it as the plugin identity.
const { copyFileSync, existsSync, readFileSync } = require('node:fs');
const { dirname, relative, resolve } = require('node:path');

const packageRoot = resolve(__dirname, '..');
const coreSource = resolve(packageRoot, 'src');
const emptyRegistrations = resolve(__dirname, 'empty-route-registrations.ts');
const emptyWorkplace = resolve(__dirname, 'empty-workplace.ts');
const emptyAvatar = resolve(__dirname, 'empty-avatar.ts');
const emptyLayout = resolve(__dirname, 'empty-layout.ts');
const externalGlobal = resolve(__dirname, 'external-global.ts');
const logo = resolve(packageRoot, 'public/logo.svg');
const tailwindSource = resolve(coreSource, 'tailwind.css');
const tailwindStyles = require.resolve('tailwindcss/index.css');

function resolveAvatarContributions(cwd, configured) {
  if (configured !== undefined) {
    if (typeof configured !== 'string' || !configured.trim()) {
      throw new TypeError('avatarContributions must name a compile-time module.');
    }
    return resolve(cwd, configured);
  }
  const ownedAvatar = resolve(cwd, 'src/business/avatar.ts');
  return existsSync(ownedAvatar) ? ownedAvatar : emptyAvatar;
}

function resolveLayoutContributions(cwd, configured) {
  if (configured !== undefined) {
    if (typeof configured !== 'string' || !configured.trim()) {
      throw new TypeError('layoutContributions must name a compile-time module.');
    }
    return resolve(cwd, configured);
  }
  const ownedLayout = resolve(cwd, 'src/business/layout.ts');
  return existsSync(ownedLayout) ? ownedLayout : emptyLayout;
}

module.exports = function mssAdminPlugin(api) {
  api.describe({
    key: 'mssAdmin',
    config: {
      schema({ zod }) {
        return zod
          .object({
            packageRoot: zod.string(),
            routeRegistrations: zod.string(),
            workplaceContributions: zod.string(),
            avatarContributions: zod.string(),
            layoutContributions: zod.string(),
          })
          .partial();
      },
    },
    enableBy: api.EnableBy.config,
  });

  api.modifyConfig((memo) => {
    const registrations = resolve(api.cwd, memo.mssAdmin?.routeRegistrations || emptyRegistrations);
    const workplace = resolve(api.cwd, memo.mssAdmin?.workplaceContributions || emptyWorkplace);
    const avatar = resolveAvatarContributions(api.cwd, memo.mssAdmin?.avatarContributions);
    const layout = resolveLayoutContributions(api.cwd, memo.mssAdmin?.layoutContributions);
    const includes = new Set([...(memo.extraBabelIncludes || []), coreSource]);
    return {
      ...memo,
      alias: {
        ...(memo.alias || {}),
        '@mss-admin-core': coreSource,
        '@mss-admin-business/routes': registrations,
        '@mss-admin-business/workplace': workplace,
        '@mss-admin-business/avatar': avatar,
        '@mss-admin-business/layout': layout,
      },
      extraBabelIncludes: [...includes],
    };
  });

  api.modifyTSConfig((memo) => {
    const registrations = resolve(
      api.cwd,
      api.config.mssAdmin?.routeRegistrations || emptyRegistrations,
    );
    return {
      ...memo,
      compilerOptions: {
        ...(memo.compilerOptions || {}),
        paths: {
          ...(memo.compilerOptions?.paths || {}),
          '@mss-admin-core/*': [`${coreSource}/*`],
          '@mss-admin-business/routes': [registrations],
          '@mss-admin-business/workplace': [
            resolve(api.cwd, api.config.mssAdmin?.workplaceContributions || emptyWorkplace),
          ],
          '@mss-admin-business/avatar': [
            resolveAvatarContributions(api.cwd, api.config.mssAdmin?.avatarContributions),
          ],
          '@mss-admin-business/layout': [
            resolveLayoutContributions(api.cwd, api.config.mssAdmin?.layoutContributions),
          ],
        },
      },
    };
  });

  api.addBeforeMiddlewares(() => {
    const devHealthLaunchNonce = process.env.MSS_DEV_HEALTH_NONCE;
    if (!devHealthLaunchNonce) return [];
    return [
      (_request, response, next) => {
        response.setHeader('X-MSS-Dev-Launch', devHealthLaunchNonce);
        next();
      },
    ];
  });

  if (resolve(api.paths.absSrcPath) !== coreSource) {
    const generatedTailwind = resolve(api.paths.absTmpPath, 'mss-admin-tailwind.css');
    api.onGenerateFiles(() => {
      const importDirective = '@import "tailwindcss" source(none);';
      const sourceDirective = '@source "./**/*.{ts,tsx}";';
      const sourcePath = (value) => value.replaceAll('\\', '/');
      const template = readFileSync(tailwindSource, 'utf8');
      if (!template.includes(importDirective)) {
        throw new Error('Admin Tailwind import directive is missing');
      }
      if (!template.includes(sourceDirective)) {
        throw new Error('Admin Tailwind source directive is missing');
      }
      const relativeStyles = sourcePath(relative(dirname(generatedTailwind), tailwindStyles));
      const styleSpecifier = relativeStyles.startsWith('.')
        ? relativeStyles
        : `./${relativeStyles}`;
      const content = template
        // Design-system partials are imported relative to src/; pin them to the core package.
        .replace(
          /@import "\.\/([^"]+\.css)";/g,
          (_match, file) => `@import "${sourcePath(resolve(coreSource, file))}";`,
        )
        .replace(importDirective, `@import "${styleSpecifier}" source(none);`)
        .replace(
          sourceDirective,
          [
            `@source "${sourcePath(coreSource)}/**/*.{ts,tsx}";`,
            `@source "${sourcePath(api.paths.absSrcPath)}/**/*.{ts,tsx}";`,
          ].join('\n'),
        );
      api.writeTmpFile({ noPluginDir: true, path: 'mss-admin-tailwind.css', content });
    });
    api.addEntryImportsAhead(() => [{ source: generatedTailwind }, { source: externalGlobal }]);
    api.addBeforeMiddlewares(() => [
      (request, response, next) => {
        if (request.path !== '/logo.svg') {
          next();
          return;
        }
        response.sendFile(logo);
      },
    ]);
    api.onBuildComplete(({ err }) => {
      if (!err) copyFileSync(logo, resolve(api.paths.absOutputPath, 'logo.svg'));
    });
  }

  api.addTmpGenerateWatcherPaths(() => {
    const registrations = resolve(
      api.cwd,
      api.config.mssAdmin?.routeRegistrations || emptyRegistrations,
    );
    const workplace = resolve(
      api.cwd,
      api.config.mssAdmin?.workplaceContributions || emptyWorkplace,
    );
    const avatar = resolveAvatarContributions(api.cwd, api.config.mssAdmin?.avatarContributions);
    const layout = resolveLayoutContributions(api.cwd, api.config.mssAdmin?.layoutContributions);
    return [coreSource, registrations, workplace, avatar, layout, tailwindSource].filter((entry) =>
      existsSync(entry),
    );
  });
};

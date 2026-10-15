import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createThemeConfig } from '../src/shared/design-system/theme';
import { brand } from '../src/shared/design-system/tokens';
import { CODE_THEME_DEFAULTS } from '../src/shared/theme/contract';

const source = (path: string) => readFileSync(resolve(import.meta.dirname, '../src', path), 'utf8');

describe('public auth theme contract', () => {
  it('leaves submit paint and state colors to the semantic primary Button', () => {
    const css = source('shared/design-system/styles/auth.css');
    const submitRules = css.match(/\.mss-auth-submit[^{}]*\{[^}]*\}/g) ?? [];
    expect(submitRules).toHaveLength(1);
    expect(submitRules[0]).not.toMatch(/(?:background|color|box-shadow|opacity|border\s*:)/);
    expect(source('pages/User/Login/index.tsx')).toMatch(
      /submitButtonProps:\s*\{\s*type: 'primary'/,
    );
    // A :root alias cannot reference tokens only defined below ConfigProvider.
    expect(source('shared/design-system/styles/base.css')).not.toContain('--mss-brand-gradient');
  });

  it.each(['light', 'realDark'] as const)('respects configured primary color in %s', (navTheme) => {
    const config = createThemeConfig({
      ...CODE_THEME_DEFAULTS,
      navTheme,
      colorPrimary: brand.success,
    });
    expect(config.token?.colorPrimary).toBe(brand.success);
    expect(config.cssVar).toEqual({ prefix: 'mss' });
    expect(config.components?.Button).not.toHaveProperty('colorPrimary');
  });

  it('keeps a token-based mobile backdrop when the desktop hero is hidden', () => {
    const css = source('shared/design-system/styles/auth.css');
    expect(source('modules/auth/AuthSplitLayout.tsx')).toContain('className="mss-auth-main ');
    expect(css).toMatch(/@media \(width < 1024px\)\s*\{\s*\.mss-auth-main/);
    expect(css).toContain('var(--mss-color-primary-bg)');
    expect(css).toContain('var(--mss-color-primary-bg-hover)');
  });
});

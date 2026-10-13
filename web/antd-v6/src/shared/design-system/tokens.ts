/**
 * Single source of design tokens. Ant Design receives these through
 * `createThemeConfig` and re-exports them as `--mss-*` CSS variables
 * (`cssVar.prefix = 'mss'`); ProLayout receives `layoutTokens`. CSS and
 * components must consume the CSS variables or these constants — never raw
 * hex values (enforced by `scripts/check-style-guardrails.mjs`).
 */

export const brand = {
  primary: '#3b5bfd',
  /** Secondary stop of the brand gradient (login CTA, hero). */
  accent: '#6b4dff',
  success: '#12b76a',
  warning: '#f79009',
  error: '#f04438',
} as const;

/** Login hero backdrop (always dark, independent of theme). Mirrored in styles/base.css. */
export const hero = {
  from: '#4f6bff',
  via: '#2a2f8f',
  to: '#0f1240',
} as const;

export const palette = {
  light: {
    bgLayout: '#f5f7fb',
    bgContainer: '#ffffff',
    bgElevated: '#ffffff',
    bgSider: '#ffffff',
    bgTableHeader: '#f8fafc',
    border: '#e4e7ee',
    borderSecondary: '#eef0f5',
    text: '#111827',
    textSecondary: '#4b5563',
    textTertiary: '#6b7280',
    textQuaternary: '#9ca3af',
    selectedBg: 'rgba(59, 91, 253, 0.08)',
    selectedText: brand.primary,
    hoverBg: 'rgba(17, 24, 39, 0.04)',
    headerGlass: 'rgba(255, 255, 255, 0.78)',
    headerGlassScrolled: 'rgba(255, 255, 255, 0.86)',
  },
  dark: {
    bgLayout: '#0b0d12',
    bgContainer: '#12151c',
    bgElevated: '#191d26',
    bgSider: '#0f1218',
    bgTableHeader: '#151922',
    border: '#2a2f3b',
    borderSecondary: '#20242e',
    text: '#e8eaf0',
    textSecondary: '#a3a9b8',
    textTertiary: '#8a91a0',
    textQuaternary: '#6b7280',
    selectedBg: 'rgba(59, 91, 253, 0.18)',
    selectedText: '#8ea2ff',
    hoverBg: 'rgba(255, 255, 255, 0.04)',
    headerGlass: 'rgba(18, 21, 28, 0.78)',
    headerGlassScrolled: 'rgba(18, 21, 28, 0.86)',
  },
} as const;

export type PaletteMode = keyof typeof palette;

/** Layout metrics shared by ProLayout, the page shell and overlays. */
export const layoutMetrics = {
  siderWidth: 232,
  headerHeight: 56,
  pagePadding: 24,
} as const;

/** Overlay widths: pick a size, never a pixel value, in feature code. */
export const overlayWidths = {
  modal: { sm: 480, md: 720, lg: 880 },
  drawer: { md: 560, lg: 720 },
} as const;

export type ModalSize = keyof typeof overlayWidths.modal;
export type DrawerSize = keyof typeof overlayWidths.drawer;

export const motion = {
  fast: '0.12s',
  mid: '0.18s',
  slow: '0.24s',
  easeOut: 'cubic-bezier(0.22, 1, 0.36, 1)',
  easeInOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
} as const;

export function layoutTokens(mode: PaletteMode) {
  const colors = palette[mode];
  return {
    bgLayout: colors.bgLayout,
    header: {
      colorBgHeader: colors.headerGlass,
      colorBgScrollHeader: colors.headerGlassScrolled,
      heightLayoutHeader: layoutMetrics.headerHeight,
    },
    sider: {
      colorMenuBackground: colors.bgSider,
      colorBgMenuItemSelected: colors.selectedBg,
      colorBgMenuItemHover: colors.hoverBg,
      colorTextMenuSelected: colors.selectedText,
      colorTextSubMenuSelected: colors.selectedText,
      colorTextMenu: colors.textSecondary,
      colorTextMenuSecondary: colors.textQuaternary,
      colorTextMenuTitle: colors.text,
      colorMenuItemDivider: colors.borderSecondary,
      paddingInlineLayoutMenu: 8,
    },
  };
}

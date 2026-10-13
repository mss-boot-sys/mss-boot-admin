import type { ThemeConfig } from 'antd';
import { theme } from 'antd';
import type { ThemeSettings } from '../theme/contract';
import { brand, motion, type PaletteMode, palette } from './tokens';

/**
 * Latin glyphs use Inter; CJK glyphs fall through to the platform's modern
 * sans-serif face instead of the browser default (often a serif on Windows
 * and Linux).
 */
export const FONT_FAMILY =
  "Inter, 'PingFang SC', 'HarmonyOS Sans SC', 'Microsoft YaHei', 'Noto Sans SC', 'Noto Sans CJK SC', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
export const FONT_FAMILY_CODE =
  "'JetBrains Mono', 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";

type Token = NonNullable<ThemeConfig['token']>;

const sharedToken: Token = {
  fontFamily: FONT_FAMILY,
  fontFamilyCode: FONT_FAMILY_CODE,
  fontSize: 14,
  fontSizeHeading1: 28,
  fontSizeHeading2: 22,
  fontSizeHeading3: 18,
  fontSizeHeading4: 16,
  borderRadius: 8,
  borderRadiusXS: 4,
  borderRadiusSM: 6,
  borderRadiusLG: 12,
  controlHeight: 34,
  controlHeightSM: 26,
  controlHeightLG: 40,
  colorSuccess: brand.success,
  colorWarning: brand.warning,
  colorError: brand.error,
  colorInfo: brand.primary,
  motionDurationFast: motion.fast,
  motionDurationMid: motion.mid,
  motionDurationSlow: motion.slow,
  motionEaseOut: motion.easeOut,
  motionEaseInOut: motion.easeInOut,
  wireframe: false,
};

function surfaceToken(mode: PaletteMode): Token {
  const colors = palette[mode];
  const dark = mode === 'dark';
  return {
    colorBgLayout: colors.bgLayout,
    colorBgContainer: colors.bgContainer,
    colorBgElevated: colors.bgElevated,
    colorBorder: colors.border,
    colorBorderSecondary: colors.borderSecondary,
    colorText: colors.text,
    colorTextSecondary: colors.textSecondary,
    colorTextTertiary: colors.textTertiary,
    colorTextQuaternary: colors.textQuaternary,
    boxShadow: dark
      ? '0 12px 32px -8px rgba(0, 0, 0, 0.6)'
      : '0 8px 24px -6px rgba(16, 24, 40, 0.10), 0 2px 6px rgba(16, 24, 40, 0.04)',
    boxShadowSecondary: dark
      ? '0 12px 32px -8px rgba(0, 0, 0, 0.65)'
      : '0 8px 24px -6px rgba(16, 24, 40, 0.12), 0 2px 6px rgba(16, 24, 40, 0.05)',
    boxShadowTertiary: dark ? '0 1px 2px rgba(0, 0, 0, 0.4)' : '0 1px 2px rgba(16, 24, 40, 0.05)',
  };
}

export function createThemeConfig(settings: ThemeSettings): ThemeConfig {
  const dark = settings.navTheme === 'realDark';
  const mode: PaletteMode = dark ? 'dark' : 'light';
  const colors = palette[mode];
  const selectedBg = colors.selectedBg;
  const selectedColor = dark ? colors.selectedText : settings.colorPrimary;
  return {
    algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    cssVar: { prefix: 'mss' },
    token: {
      ...sharedToken,
      ...surfaceToken(mode),
      colorPrimary: settings.colorPrimary,
    },
    components: {
      Layout: {
        bodyBg: colors.bgLayout,
        headerBg: colors.bgContainer,
        siderBg: colors.bgSider,
      },
      Menu: {
        itemHeight: 38,
        itemBorderRadius: 8,
        itemMarginInline: 8,
        itemSelectedBg: selectedBg,
        itemSelectedColor: selectedColor,
        darkItemBg: 'transparent',
        darkSubMenuItemBg: 'transparent',
        darkItemSelectedBg: selectedBg,
        darkItemSelectedColor: selectedColor,
        subMenuItemBg: 'transparent',
        collapsedIconSize: 16,
        iconSize: 15,
      },
      Button: {
        controlHeight: 34,
        fontWeight: 500,
        primaryShadow: '0 4px 12px rgba(59, 91, 253, 0.28)',
        defaultShadow: 'none',
        dangerShadow: 'none',
      },
      Card: { headerFontSize: 15 },
      Table: {
        headerBg: colors.bgTableHeader,
        headerColor: colors.textTertiary,
        headerSplitColor: 'transparent',
        rowHoverBg: dark ? 'rgba(59, 91, 253, 0.06)' : 'rgba(59, 91, 253, 0.03)',
        cellPaddingBlock: 12,
        cellPaddingInline: 16,
      },
      Input: { activeShadow: '0 0 0 3px rgba(59, 91, 253, 0.14)' },
      Select: { optionSelectedBg: colors.selectedBg },
      Modal: { titleFontSize: 17 },
      Result: { titleFontSize: 22 },
    },
  };
}

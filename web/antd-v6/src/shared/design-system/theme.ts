import type { ThemeConfig } from 'antd';
import { theme } from 'antd';
import type { ThemeSettings } from '../theme/contract';

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
  colorSuccess: '#12b76a',
  colorWarning: '#f79009',
  colorError: '#f04438',
  colorInfo: '#3b5bfd',
  motionDurationFast: '0.12s',
  motionDurationMid: '0.18s',
  motionDurationSlow: '0.24s',
  motionEaseOut: 'cubic-bezier(0.22, 1, 0.36, 1)',
  motionEaseInOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
  wireframe: false,
};

/** Three surfaces: layout (page) < container (cards) < elevated (popups). */
const lightToken: Token = {
  colorBgLayout: '#f5f7fb',
  colorBgContainer: '#ffffff',
  colorBgElevated: '#ffffff',
  colorBorder: '#e4e7ee',
  colorBorderSecondary: '#eef0f5',
  colorText: '#111827',
  colorTextSecondary: '#4b5563',
  colorTextTertiary: '#6b7280',
  colorTextQuaternary: '#9ca3af',
  boxShadow: '0 8px 24px -6px rgba(16, 24, 40, 0.10), 0 2px 6px rgba(16, 24, 40, 0.04)',
  boxShadowSecondary: '0 8px 24px -6px rgba(16, 24, 40, 0.12), 0 2px 6px rgba(16, 24, 40, 0.05)',
  boxShadowTertiary: '0 1px 2px rgba(16, 24, 40, 0.05)',
};

const darkToken: Token = {
  colorBgLayout: '#0b0d12',
  colorBgContainer: '#12151c',
  colorBgElevated: '#191d26',
  colorBorder: '#2a2f3b',
  colorBorderSecondary: '#20242e',
  colorText: '#e8eaf0',
  colorTextSecondary: '#a3a9b8',
  colorTextTertiary: '#8a91a0',
  colorTextQuaternary: '#6b7280',
  boxShadow: '0 12px 32px -8px rgba(0, 0, 0, 0.6)',
  boxShadowSecondary: '0 12px 32px -8px rgba(0, 0, 0, 0.65)',
  boxShadowTertiary: '0 1px 2px rgba(0, 0, 0, 0.4)',
};

export function createThemeConfig(settings: ThemeSettings): ThemeConfig {
  const dark = settings.navTheme === 'realDark';
  const selectedBg = dark ? 'rgba(59, 91, 253, 0.18)' : 'rgba(59, 91, 253, 0.08)';
  const selectedColor = dark ? '#8ea2ff' : settings.colorPrimary;
  return {
    algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    cssVar: { prefix: 'mss' },
    token: {
      ...sharedToken,
      ...(dark ? darkToken : lightToken),
      colorPrimary: settings.colorPrimary,
    },
    components: {
      Layout: {
        bodyBg: dark ? darkToken.colorBgLayout : lightToken.colorBgLayout,
        headerBg: dark ? '#12151c' : '#ffffff',
        siderBg: dark ? '#0f1218' : '#ffffff',
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
        headerBg: dark ? '#151922' : '#f8fafc',
        headerColor: dark ? '#8a91a0' : '#6b7280',
        headerSplitColor: 'transparent',
        rowHoverBg: dark ? 'rgba(59, 91, 253, 0.06)' : 'rgba(59, 91, 253, 0.03)',
        cellPaddingBlock: 12,
        cellPaddingInline: 16,
      },
      Input: { activeShadow: '0 0 0 3px rgba(59, 91, 253, 0.14)' },
      Select: { optionSelectedBg: dark ? 'rgba(59, 91, 253, 0.18)' : '#eef2ff' },
      Modal: { titleFontSize: 17 },
      Result: { titleFontSize: 22 },
    },
  };
}

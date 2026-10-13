import type { ProLayoutProps } from '@ant-design/pro-components';

export const defaultSettings = {
  navTheme: 'light',
  colorPrimary: '#3b5bfd',
  layout: 'side',
  contentWidth: 'Fluid',
  fixedHeader: true,
  fixSiderbar: true,
  colorWeak: false,
  title: 'mss-boot-io',
  logo: '/logo.svg',
  splitMenus: false,
} satisfies ProLayoutProps & { logo: string };

export default defaultSettings;

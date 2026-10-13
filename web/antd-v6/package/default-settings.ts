import type { ProLayoutProps } from '@ant-design/pro-components';

export const defaultSettings = {
  navTheme: 'light',
  colorPrimary: '#3b5bfd',
  layout: 'mix',
  contentWidth: 'Fluid',
  fixedHeader: false,
  fixSiderbar: true,
  colorWeak: false,
  title: 'mss-boot-io',
  logo: '/logo.svg',
  splitMenus: false,
} satisfies ProLayoutProps & { logo: string };

export default defaultSettings;

export interface AdminBusinessRoute {
  path?: string;
  component?: string;
  redirect?: string;
  routes?: AdminBusinessRoute[];
  [key: string]: unknown;
}

export interface AdminWebExtension {
  /** Surface name; pages mount at /<surface>, its API is /<surface>/api. */
  surface: string;
  /** Routes; every path must stay below /<surface>. */
  routes: AdminBusinessRoute[];
  /** false (default) for no layout, or a compile-time layout module. */
  layout?: false | string;
}

export interface BusinessAdminOptions {
  title?: string;
  apiTarget?: string;
  businessRoutes?: AdminBusinessRoute[];
  routeRegistrations?: string;
  workplaceContributions?: string;
  avatarContributions?: string;
  layoutContributions?: string;
  useUtoopack?: boolean;
  extensions?: AdminWebExtension[];
}

export declare function defineBusinessAdmin(
  options?: BusinessAdminOptions,
): Record<string, unknown>;

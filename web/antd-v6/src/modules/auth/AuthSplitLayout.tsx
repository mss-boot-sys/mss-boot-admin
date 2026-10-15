import { SelectLang, useIntl } from '@umijs/max';
import type { ReactNode } from 'react';

/**
 * Shared frame for every public auth page (login, register, recovery,
 * OAuth callbacks): brand hero on the left, a 380px form column on the right.
 */
export function AuthSplitLayout({
  brandTitle,
  brandLogo,
  title,
  description,
  children,
}: {
  brandTitle: ReactNode;
  brandLogo: string;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  const intl = useIntl();
  const heroFeatures = [
    intl.formatMessage({ id: 'pages.login.heroFeature1' }),
    intl.formatMessage({ id: 'pages.login.heroFeature2' }),
    intl.formatMessage({ id: 'pages.login.heroFeature3' }),
  ];
  return (
    <div className="grid min-h-screen bg-surface lg:grid-cols-[1.1fr_1fr]">
      <aside className="mss-auth-hero relative hidden flex-col justify-between overflow-hidden p-14 text-white lg:flex">
        <div aria-hidden className="mss-auth-hero-grid pointer-events-none absolute inset-0" />
        <div className="relative flex items-center gap-3 text-lg font-bold">
          <img alt="" className="h-8 w-8 rounded-lg bg-white/90 p-1" src={brandLogo} />
          {brandTitle}
        </div>
        <div className="mss-page-enter relative">
          <h2 className="m-0 mb-4 max-w-[380px] text-[36px] leading-tight font-bold">
            {intl.formatMessage({ id: 'pages.login.heroTitle' })}
          </h2>
          <p className="m-0 max-w-[440px] text-base leading-7 opacity-75">
            {intl.formatMessage({ id: 'pages.login.heroDescription' })}
          </p>
        </div>
        <div className="relative flex gap-7 text-[13px] opacity-80">
          {heroFeatures.map((feature) => (
            <span key={feature}>● {feature}</span>
          ))}
        </div>
      </aside>
      <main className="mss-auth-main relative flex items-center justify-center bg-canvas px-4 py-10">
        <div className="absolute right-4 top-4 z-10 rounded-lg bg-surface">
          <SelectLang />
        </div>
        <div className="mss-page-enter mss-auth-form w-full max-w-[380px]">
          <h1 className="m-0 text-[22px] font-semibold leading-snug text-fg">{title}</h1>
          {description ? (
            <p className="mb-7 mt-1 text-[13px] text-fg-secondary">{description}</p>
          ) : (
            <div className="mb-7" />
          )}
          {children}
        </div>
      </main>
    </div>
  );
}

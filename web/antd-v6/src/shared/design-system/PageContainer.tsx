import { createContext, type ReactNode, useContext, useState } from 'react';

export interface PageContainerProps {
  title?: ReactNode;
  /** Short description rendered under the title. */
  content?: ReactNode;
  /** Page-level actions aligned to the right of the title. */
  extra?: ReactNode;
  children?: ReactNode;
}

const PageHeaderActionsContext = createContext<HTMLElement | null>(null);

/**
 * DOM node in the page header where nested modules may portal their primary
 * actions (for example a list's "Create" button) so that every page keeps a
 * single, consistently placed primary action.
 */
export function usePageHeaderActionsSlot() {
  return useContext(PageHeaderActionsContext);
}

/**
 * Application page frame: semantic h1, description, right-aligned actions and
 * the page-enter motion. It intentionally replaces the ProComponents header so
 * spacing and typography follow the design-system tokens.
 */
export function PageContainer({ title, content, extra, children }: PageContainerProps) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <PageHeaderActionsContext.Provider value={slot}>
      <div className="mss-page-enter flex flex-col gap-4">
        {title !== undefined && title !== null && title !== false ? (
          <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pb-1">
            <div className="min-w-0">
              <h1
                style={{
                  color: 'var(--mss-color-text)',
                  fontSize: 22,
                  fontWeight: 650,
                  letterSpacing: '-0.01em',
                  lineHeight: 1.35,
                  margin: 0,
                }}
              >
                {title}
              </h1>
              {content ? (
                <div
                  className="mt-1"
                  style={{ color: 'var(--mss-color-text-secondary)', fontSize: 13 }}
                >
                  {content}
                </div>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {extra}
              <div ref={setSlot} className="flex items-center gap-2 empty:hidden" />
            </div>
          </header>
        ) : null}
        {children}
      </div>
    </PageHeaderActionsContext.Provider>
  );
}

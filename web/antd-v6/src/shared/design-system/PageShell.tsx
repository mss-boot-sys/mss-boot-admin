import { createContext, type ReactNode, useContext, useState } from 'react';
import { createPortal } from 'react-dom';

export interface PageShellProps {
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
 * Renders children into the page header action slot when a PageShell is
 * present, or in place otherwise (embedded usage, tests).
 */
export function PageHeaderActions({ children }: { children: ReactNode }) {
  const slot = usePageHeaderActionsSlot();
  return slot ? createPortal(children, slot) : children;
}

/**
 * Application page frame: semantic h1, description, right-aligned actions and
 * the page-enter motion. Every routed page renders exactly one PageShell.
 */
export function PageShell({ title, content, extra, children }: PageShellProps) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <PageHeaderActionsContext.Provider value={slot}>
      <div className="mss-page-enter flex flex-col gap-4">
        {title !== undefined && title !== null && title !== false ? (
          <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pb-1">
            <div className="min-w-0">
              <h1 className="mss-page-title">{title}</h1>
              {content ? <div className="mss-page-description">{content}</div> : null}
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

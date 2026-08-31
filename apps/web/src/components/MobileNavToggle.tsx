'use client';

import { useState, type ReactElement, type ReactNode } from 'react';

export interface MobileNavToggleProps {
  readonly children: ReactNode;
}

/**
 * Wraps the primary nav list so it collapses to a hamburger toggle below the `md` breakpoint
 * and stays permanently visible above it. The nav landmark and its <ul> stay exactly where
 * they were in the DOM -- this only adds a toggle button and a class that shows/hides them,
 * so the a11y suite's landmark/heading assertions are unaffected.
 */
export function MobileNavToggle({ children }: MobileNavToggleProps): ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="inline-flex items-center justify-center rounded-md p-2 text-plum-900 hover:bg-plum-100 md:hidden"
        aria-expanded={open}
        aria-controls="primary-nav-list"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="sr-only">{open ? 'Close menu' : 'Open menu'}</span>
        <svg
          viewBox="0 0 24 24"
          width="24"
          height="24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          {open ? (
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          ) : (
            <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
          )}
        </svg>
      </button>
      <div id="primary-nav-list" className={open ? 'block' : 'hidden md:block'}>
        {children}
      </div>
    </>
  );
}

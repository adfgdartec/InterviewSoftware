import type { ReactElement, ReactNode } from 'react';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { BRAND } from '@loopcraft/core';
import { MobileNavToggle } from '../components/MobileNavToggle.js';
import './globals.css';

/**
 * Root layout. Spec §5.6 requires WCAG 2.2 AA and full keyboard operation; spec §5.1 requires
 * the EU AI Act Article 50 disclosure that the user is interacting with an AI system, which
 * remains effective and was not deferred by the Digital Omnibus.
 */
export const metadata = {
  title: BRAND.name,
  description: BRAND.tagline,
};

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plus-jakarta',
  display: 'swap',
});

const NAV_LINKS = [
  { href: '/', label: 'Prepare' },
  { href: '/dashboard', label: 'Progress' },
  { href: '/calibration', label: 'How scoring works' },
  { href: '/compliance', label: 'Compliance' },
  { href: '/settings', label: 'Settings' },
] as const;

export default function RootLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <html lang="en" className={plusJakartaSans.variable}>
      <body className="min-h-screen bg-neutral-50 font-sans text-neutral-900 antialiased">
        <a className="skip-link" href="#main">
          Skip to main content
        </a>

        <header className="border-b border-neutral-200 bg-white">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
            <a href="/" className="text-lg font-bold text-plum-900">
              {BRAND.name}
            </a>
            <nav aria-label="Primary">
              <MobileNavToggle>
                <ul className="flex flex-col gap-1 border-t border-neutral-200 px-4 py-2 md:flex-row md:gap-6 md:border-0 md:p-0">
                  {NAV_LINKS.map((link) => (
                    <li key={link.href}>
                      <a
                        href={link.href}
                        className="block rounded-md px-2 py-2 text-sm font-medium text-neutral-600 hover:bg-plum-100 hover:text-plum-900 md:px-1 md:py-1"
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </MobileNavToggle>
            </nav>
          </div>
          {/* Article 50: disclose that this is an AI system, prominently, not in a footnote. */}
          <p className="ai-disclosure bg-plum-900 px-4 py-2 text-center text-xs font-medium text-white sm:px-6">
            {BRAND.aiDisclosure}
          </p>
        </header>

        <main id="main" className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
          {children}
        </main>

        <footer className="border-t border-neutral-200 bg-white px-4 py-8 text-center text-sm text-neutral-600 sm:px-6">
          <p className="mx-auto max-w-[70ch]">{BRAND.scoreDisclosure}</p>
          <p className="mx-auto mt-2 max-w-[70ch]">{BRAND.affiliationDisclaimer}</p>
        </footer>
      </body>
    </html>
  );
}

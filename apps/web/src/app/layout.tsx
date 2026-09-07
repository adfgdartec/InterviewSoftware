import type { ReactElement, ReactNode } from 'react';
import { Plus_Jakarta_Sans, Instrument_Serif, JetBrains_Mono } from 'next/font/google';
import { BRAND } from '@loopcraft/core';
import { MobileNavToggle } from '../components/MobileNavToggle.js';
import { currentUser } from '../server/deps.js';
import { signOut } from './auth/actions.js';
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

/**
 * The display face. Plus Jakarta Sans is a good interface font and a characterless
 * headline -- one sans doing every job is the most reliable way to look generated. Instrument
 * Serif carries the headline voice; it is upright, never italic.
 */
const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-instrument-serif',
  display: 'swap',
});

/** Scores, timings, round counts -- anything that lines up in a column or gets compared. */
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

const NAV_LINKS = [
  { href: '/', label: 'Prepare' },
  { href: '/dashboard', label: 'Progress' },
  { href: '/calibration', label: 'How scoring works' },
  { href: '/compliance', label: 'Compliance' },
  { href: '/settings', label: 'Settings' },
] as const;

const fontVars = `${plusJakartaSans.variable} ${instrumentSerif.variable} ${jetbrainsMono.variable}`;

export default async function RootLayout({ children }: { children: ReactNode }): Promise<ReactElement> {
  // Resolved server-side so a signed-out visitor never sees signed-in chrome flash first.
  const user = await currentUser();
  return (
    <html lang="en" className={fontVars}>
      <body className="min-h-screen font-sans antialiased">
        <a className="skip-link" href="#main">
          Skip to main content
        </a>

        {/* N9 edge-aligned: wordmark hard left, nav hard right, one hairline underneath. The
            centred max-width bar with a pill button on the right is the AI-nav tell. */}
        <header className="border-b border-rule bg-raised">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5 sm:px-8">
            <a
              href="/"
              className="display text-xl text-plum-900 transition-colors hover:text-plum-700"
            >
              {BRAND.name}
            </a>
            <nav aria-label="Primary">
              <MobileNavToggle>
                <ul className="flex flex-col gap-0.5 border-t border-rule py-2 md:flex-row md:items-center md:gap-1 md:border-0 md:py-0">
                  {NAV_LINKS.map((link) => (
                    <li key={link.href}>
                      <a
                        href={link.href}
                        className="block whitespace-nowrap rounded px-2.5 py-2 text-sm font-medium text-neutral-600 transition-colors hover:bg-plum-100 hover:text-plum-900 md:py-1.5"
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </MobileNavToggle>
            </nav>
            {user === null ? (
              <a href="/signin" className="btn btn-quiet hidden md:inline-flex">
                Sign in
              </a>
            ) : (
              <form action={signOut} className="hidden md:block">
                <button type="submit" className="btn btn-quiet">
                  Sign out
                </button>
              </form>
            )}
          </div>
          {/* Article 50: disclose that this is an AI system, prominently, not in a footnote.
              Deliberately outside the collapsible region -- it is never folded into a menu. */}
          <p className="ai-disclosure label border-t border-plum-900/15 bg-plum-900 px-4 py-1.5 text-center text-white sm:px-8">
            {BRAND.aiDisclosure}
          </p>
        </header>

        <main id="main" className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-8 sm:py-14">
          {children}
        </main>

        {/* Ft5 statement: the footer is two compliance sentences, so it is set as a statement
            block rather than dressed up as a four-column link farm it has no links for. */}
        <footer className="mt-20 border-t border-rule bg-raised">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-8">
            <p className="display max-w-[24ch] text-2xl text-plum-900 sm:text-3xl">
              {BRAND.scoreDisclosure}
            </p>
            <p className="mt-6 max-w-[70ch] border-l-2 border-gold-600 pl-4 text-sm text-neutral-600">
              {BRAND.affiliationDisclaimer}
            </p>
            <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2">
              {[
                { href: '/terms', label: 'Terms of service' },
                { href: '/privacy', label: 'Privacy notice' },
                { href: '/compliance', label: 'Compliance' },
                { href: '/calibration', label: 'How scoring works' },
              ].map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className="text-sm text-neutral-600 underline decoration-rule-firm underline-offset-2 transition-colors hover:text-plum-700"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </footer>
      </body>
    </html>
  );
}

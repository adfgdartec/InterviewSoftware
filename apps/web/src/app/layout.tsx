import type { ReactElement, ReactNode } from 'react';
import { BRAND } from '@loopcraft/core';

/**
 * Root layout. Spec §5.6 requires WCAG 2.2 AA and full keyboard operation; spec §5.1 requires
 * the EU AI Act Article 50 disclosure that the user is interacting with an AI system, which
 * remains effective and was not deferred by the Digital Omnibus.
 */
export const metadata = {
  title: BRAND.name,
  description: BRAND.tagline,
};

export default function RootLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to main content
        </a>

        <header>
          <nav aria-label="Primary">
            <ul>
              <li><a href="/">Prepare</a></li>
              <li><a href="/dashboard">Progress</a></li>
              <li><a href="/calibration">How scoring works</a></li>
              <li><a href="/compliance">Compliance</a></li>
            </ul>
          </nav>
          {/* Article 50: disclose that this is an AI system, prominently, not in a footnote. */}
          <p className="ai-disclosure">{BRAND.aiDisclosure}</p>
        </header>

        <main id="main">{children}</main>

        <footer>
          <p>{BRAND.scoreDisclosure}</p>
          <p>{BRAND.affiliationDisclaimer}</p>
        </footer>
      </body>
    </html>
  );
}

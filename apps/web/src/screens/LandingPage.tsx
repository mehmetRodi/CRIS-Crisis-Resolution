import { Link, Navigate } from 'react-router-dom';
import { ArrowRight, Lock, Map as MapIcon, Send, ShieldCheck, Zap } from 'lucide-react';

import { SiteFooter } from '../shell/SiteFooter';
import { useAuth } from '../AuthContext';
import { Logo } from '../components/brand/Logo';
import { Button } from '../components/ui/button';
import { capabilitiesFor } from '../lib/capabilities';

/**
 * The public entry point (CRIS-54, ADR-0055).
 *
 * Replaces the previous developer index — a grid of cards labelled with ticket
 * numbers and a raw dump of the `ReportStatus` enum — which was legible to the
 * team building the product and to nobody else.
 *
 * One decision drives the layout: a person arriving here mid-emergency needs to
 * reach the report form without reading anything. So "Report an emergency" is
 * the primary action on the page and precedes supporting content on a phone. Everything else — how it works, the
 * public map, staff sign-in — sits below it.
 *
 * Operational users never see this page: they are routed to their workspace, so
 * a coordinator opening a bookmark is not made to click through a homepage.
 */
export function LandingPage() {
  const { loading, isAuthenticated, highestRole } = useAuth();
  const capabilities = capabilitiesFor(highestRole);

  // Wait for the session before deciding: redirecting on a half-resolved auth
  // state would flash this page at every signed-in coordinator on reload.
  if (loading) return null;
  if (isAuthenticated && capabilities.isOperational) {
    return <Navigate to="/workspace" replace />;
  }

  return (
    <div className="min-h-dvh bg-bg">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-lg bg-surface p-3 text-accent focus:not-sr-only focus:absolute focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex min-h-20 w-full max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
          <Logo />
          <nav aria-label="Main navigation" className="flex items-center gap-2 sm:gap-6">
            <a
              href="#how-it-works"
              className="hidden min-h-11 items-center text-sm font-medium text-fg-muted hover:text-accent sm:inline-flex"
            >
              How it works
            </a>
            <Link
              to="/about"
              className="hidden text-sm font-medium text-fg-muted hover:text-accent sm:block"
            >
              About CRIS
            </Link>
            <Button variant="secondary" size="lg" className="rounded-lg" asChild>
              <Link to="/login">
                Staff sign in
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </nav>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-6xl px-5 pb-12 sm:px-8">
        <section
          aria-labelledby="landing-heading"
          className="grid gap-10 py-10 sm:py-16 lg:grid-cols-[1.2fr_1fr] lg:items-center lg:gap-16 lg:py-20"
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
              Community reports. Coordinated response.
            </p>
            <h1
              id="landing-heading"
              className="mt-5 max-w-2xl text-4xl font-semibold leading-[1.1] tracking-tight text-fg sm:text-5xl lg:text-6xl"
            >
              Every report starts <span className="text-accent">with you.</span>
            </h1>
            <p className="mt-5 max-w-lg text-base leading-relaxed text-fg-muted sm:text-lg">
              Help response teams understand what is happening. Share what you see, where it is, and
              what help is needed.
            </p>
            <div className="mt-7 max-w-md">
              <Button size="xl" variant="primary" className="h-14 rounded-xl" asChild>
                <Link to="/report">
                  <Send aria-hidden="true" />
                  Report an emergency
                  <ArrowRight aria-hidden="true" className="ml-auto" />
                </Link>
              </Button>
              <p className="mt-3 flex items-start gap-2 text-sm leading-relaxed text-fg-muted">
                <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                No account needed. You can report anonymously.
              </p>
            </div>
          </div>

          <aside
            aria-labelledby="report-guide"
            className="overflow-hidden rounded-3xl border border-border bg-surface shadow-lg lg:rotate-1"
          >
            <div className="border-b border-border bg-accent-subtle px-6 py-5 sm:px-8">
              <span className="inline-flex size-11 items-center justify-center rounded-xl border border-accent-border bg-surface text-accent">
                <MapIcon aria-hidden="true" className="size-5" />
              </span>
              <h2 id="report-guide" className="mt-4 text-xl font-semibold tracking-tight text-fg">
                A little detail makes a difference.
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-fg-muted">
                You do not need to have every answer to send a report.
              </p>
            </div>
            <ul className="space-y-5 px-6 py-6 sm:px-8">
              {[
                { title: 'What is happening?', body: 'Describe the situation in your own words.' },
                {
                  title: 'Where is help needed?',
                  body: 'Add a location, a map pin, or a nearby landmark.',
                },
                {
                  title: 'What else can you share?',
                  body: 'Include a photo if you have one. It is optional.',
                },
              ].map((item, index) => (
                <li key={item.title} className="flex gap-3">
                  <span
                    aria-hidden="true"
                    className="tabular flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-xs font-semibold text-fg-muted"
                  >
                    {index + 1}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-fg">{item.title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-fg-muted">{item.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </aside>
        </section>

        <section
          aria-labelledby="map-heading"
          className="flex flex-col gap-5 rounded-2xl border border-border bg-surface p-6 sm:flex-row sm:items-center sm:justify-between sm:px-8"
        >
          <div className="flex items-start gap-4">
            <MapIcon aria-hidden="true" className="mt-1 size-6 shrink-0 text-accent" />
            <div>
              <h2 id="map-heading" className="text-base font-semibold text-fg">
                See the bigger picture
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-fg-muted">
                Explore reported incidents on the public map.
              </p>
            </div>
          </div>
          <Button size="lg" variant="secondary" className="shrink-0 rounded-lg" asChild>
            <Link to="/map">
              View incident map <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </section>

        <section aria-labelledby="how-it-works" className="py-12 sm:py-16">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
            From report to review
          </p>
          <h2
            id="how-it-works"
            className="mt-3 text-2xl font-semibold tracking-tight text-fg sm:text-3xl"
          >
            What happens next
          </h2>
          <ol className="mt-8 grid gap-8 sm:grid-cols-3">
            {[
              {
                icon: Send,
                title: 'You share the situation',
                body: 'Start with what you know. Your description gives response teams a clearer view of the incident.',
              },
              {
                icon: Zap,
                title: 'Your report is triaged',
                body: 'Automated analysis helps categorise reports and identify which incidents need attention first.',
              },
              {
                icon: ShieldCheck,
                title: 'Coordinators review',
                body: 'Response coordinators can review incident details, verify reports, and assign teams.',
              },
            ].map((step, index) => (
              <li
                key={step.title}
                className="rounded-2xl border border-border bg-surface p-6 shadow-xs"
              >
                <div className="flex items-center gap-3">
                  <step.icon aria-hidden="true" className="size-5 text-accent" />
                  <span className="tabular text-xs font-medium text-fg-muted">
                    Step {index + 1}
                  </span>
                </div>
                <h3 className="mt-4 text-base font-semibold text-fg">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-fg-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section
          aria-labelledby="privacy-heading"
          className="flex items-start gap-4 rounded-xl bg-surface-sunken p-6"
        >
          <Lock aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-accent" />
          <div>
            <h2 id="privacy-heading" className="text-sm font-semibold text-fg">
              Share the situation. Keep personal details out.
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-fg-muted">
              You can submit without signing in. Focus your description on the incident and avoid
              including names, phone numbers, or other personal details in your text or photos.
            </p>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

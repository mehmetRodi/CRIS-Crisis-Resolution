import { Link, Navigate } from 'react-router-dom';
import { ArrowRight, Lock, Map as MapIcon, Send, ShieldCheck, Zap } from 'lucide-react';

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
 * the largest element on the page, it is above the fold on a phone, and nothing
 * competes with it for that position. Everything else — how it works, the
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
    <div className="min-h-dvh bg-transparent">
      <header className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-5">
        <Logo />
        <Button variant="ghost" size="sm" asChild>
          <Link to="/login">
            Staff sign in
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </header>

      <main className="mx-auto w-full max-w-5xl px-5 pb-20">
        {/* ── Primary action ────────────────────────────────────────────── */}
        <section className="py-10 sm:py-16">
          <p className="text-sm font-medium text-accent">Emergency reporting</p>
          <h1 className="mt-3 max-w-2xl text-3xl font-semibold leading-tight tracking-tight text-fg sm:text-4xl">
            Report what is happening. Get it to the people who can respond.
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-fg-muted">
            Describe the situation in your own words. It is classified, located, and ranked against
            every other open incident within seconds, then routed to the nearest response team.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:max-w-md">
            <Button size="xl" variant="primary" asChild>
              <Link to="/report">
                <Send aria-hidden="true" />
                Report an emergency
              </Link>
            </Button>
            <Button size="lg" variant="secondary" asChild>
              <Link to="/map">
                <MapIcon aria-hidden="true" />
                View the live incident map
              </Link>
            </Button>
          </div>

          <p className="mt-4 flex items-center gap-1.5 text-xs text-fg-subtle">
            <Lock aria-hidden="true" className="size-3.5 shrink-0" />
            No account needed. You can report anonymously.
          </p>
        </section>

        {/* ── How it works ──────────────────────────────────────────────── */}
        <section aria-labelledby="how-it-works" className="border-t border-border py-10">
          <h2 id="how-it-works" className="text-sm font-semibold text-fg">
            What happens to your report
          </h2>
          <ol className="mt-5 grid gap-6 sm:grid-cols-3">
            {[
              {
                icon: Send,
                title: 'You describe it',
                body: 'Plain words are enough. Add a location and a photo if you can — neither is required.',
              },
              {
                icon: Zap,
                title: 'It is triaged in seconds',
                body: 'Your report is categorised, located, and given a priority score explained factor by factor.',
              },
              {
                icon: ShieldCheck,
                title: 'A person confirms it',
                body: 'A coordinator reviews and verifies before a team is dispatched. Nothing is actioned by AI alone.',
              },
            ].map((step, index) => (
              <li key={step.title}>
                <span className="flex size-9 items-center justify-center rounded-lg bg-accent-subtle text-accent-subtle-fg">
                  <step.icon aria-hidden="true" className="size-4" />
                </span>
                <h3 className="mt-3 text-sm font-semibold text-fg">
                  <span className="tabular text-fg-subtle">{index + 1}. </span>
                  {step.title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ── Privacy ───────────────────────────────────────────────────── */}
        <section
          aria-labelledby="privacy-heading"
          className="rounded-lg border border-border bg-surface p-5"
        >
          <h2
            id="privacy-heading"
            className="flex items-center gap-2 text-sm font-semibold text-fg"
          >
            <Lock aria-hidden="true" className="size-4 text-accent" />
            Your identity is protected
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-fg-muted">
            Contact details are never shown on the map, never sent to the classification model, and
            never shared with volunteers. The public map shows an AI-written summary of each
            incident — never the words you wrote, and never anything that identifies you.
          </p>
        </section>
      </main>
    </div>
  );
}

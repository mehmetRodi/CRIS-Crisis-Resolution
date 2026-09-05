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
        <Button
          variant="secondary"
          size="sm"
          className="rounded-lg border-border/80 bg-surface/80 shadow-2xs backdrop-blur-sm hover:bg-surface-hover"
          asChild
        >
          <Link to="/login">
            Staff sign in
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </header>

      <main className="mx-auto w-full max-w-5xl px-5 pb-20">
        {/* ── Primary action ────────────────────────────────────────────── */}
        <section className="py-10 sm:py-16">
          <div className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent shadow-2xs">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75"></span>
              <span className="relative inline-flex size-2 rounded-full bg-accent"></span>
            </span>
            <span>Live Emergency Intelligence & Coordination Platform</span>
          </div>

          <h1 className="mt-4 max-w-2xl text-3xl font-extrabold leading-tight tracking-tight text-fg sm:text-5xl">
            Report what is happening. <br className="hidden sm:inline" />
            <span className="text-accent">Get it to the people who can respond.</span>
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-fg-muted sm:text-lg">
            Describe the situation in your own words. It is classified, located, and ranked against
            every other open incident within seconds, then routed to the nearest response team.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:max-w-md">
            <Button size="xl" variant="primary" className="shadow-md hover:shadow-lg transition-all rounded-xl text-base font-semibold" asChild>
              <Link to="/report">
                <Send aria-hidden="true" className="size-5" />
                Report an emergency
              </Link>
            </Button>
            <Button size="lg" variant="secondary" className="rounded-xl border-border/80 bg-surface/90 backdrop-blur-sm shadow-2xs hover:bg-surface-hover font-medium" asChild>
              <Link to="/map">
                <MapIcon aria-hidden="true" className="size-4 text-accent" />
                View the live incident map
              </Link>
            </Button>
          </div>

          <p className="mt-4 flex items-center gap-1.5 text-xs text-fg-subtle">
            <Lock aria-hidden="true" className="size-3.5 shrink-0 text-accent" />
            No account needed. You can report anonymously.
          </p>

          {/* ── Key Highlights Strip ──────────────────────────────────────── */}
          <div className="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { stat: '< 3s', label: 'AI Classification', sub: 'Triage & geolocation' },
              { stat: '100%', label: 'PII Protected', sub: 'Zero reporter exposure' },
              { stat: 'Offline', label: 'Resilient Queue', sub: 'Guaranteed local saves' },
              { stat: 'Human', label: 'Verified Gates', sub: 'Coordinated dispatch' },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-xl border border-border/70 bg-surface/80 p-3.5 shadow-2xs backdrop-blur-xs"
              >
                <p className="text-lg font-bold tracking-tight text-accent">{item.stat}</p>
                <p className="text-xs font-semibold text-fg">{item.label}</p>
                <p className="text-[11px] text-fg-subtle">{item.sub}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── How it works ──────────────────────────────────────────────── */}
        <section aria-labelledby="how-it-works" className="border-t border-border/80 py-12">
          <div className="mb-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-accent">Workflow</p>
            <h2 id="how-it-works" className="mt-1 text-xl font-bold tracking-tight text-fg">
              What happens to your report
            </h2>
          </div>
          <ol className="grid gap-6 sm:grid-cols-3">
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
              <li
                key={step.title}
                className="group relative rounded-2xl border border-border/80 bg-surface/90 p-5 shadow-xs transition-all hover:border-accent/40 hover:shadow-md"
              >
                <div className="flex items-center justify-between">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-accent/15 text-accent ring-1 ring-accent/25 transition-transform group-hover:scale-110">
                    <step.icon aria-hidden="true" className="size-5" />
                  </span>
                  <span className="tabular text-xs font-bold text-fg-subtle bg-surface-sunken px-2 py-0.5 rounded-full border border-border/60">
                    Step {index + 1}
                  </span>
                </div>
                <h3 className="mt-4 text-base font-semibold text-fg">
                  <span className="tabular text-fg-subtle">{index + 1}. </span>
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-fg-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ── Privacy ───────────────────────────────────────────────────── */}
        <section
          aria-labelledby="privacy-heading"
          className="rounded-2xl border border-border/80 bg-surface/90 p-6 shadow-sm backdrop-blur-xs"
        >
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent ring-1 ring-accent/25">
              <Lock aria-hidden="true" className="size-5 text-accent" />
            </span>
            <div>
              <h2
                id="privacy-heading"
                className="flex items-center gap-2 text-base font-semibold text-fg"
              >
                Your identity is protected
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-fg-muted">
                Contact details are never shown on the map, never sent to the classification model, and
                never shared with volunteers. The public map shows an AI-written summary of each
                incident — never the words you wrote, and never anything that identifies you.
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

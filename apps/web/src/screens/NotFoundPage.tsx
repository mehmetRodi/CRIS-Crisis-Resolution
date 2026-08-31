import { Link } from 'react-router-dom';

import { Logo } from '../components/brand/Logo';
import { Button } from '../components/ui/button';

/**
 * Unknown route (CRIS-54).
 *
 * Offers the report form as the primary way out, not just "go home". Someone
 * who mistyped or followed a stale link during an emergency needs the fastest
 * route to the thing they came to do, and a 404 is a bad place to make them
 * navigate a homepage first.
 */
export function NotFoundPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-transparent px-6 text-center">
      <Logo />
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-fg">Page not found</h1>
        <p className="mt-2 max-w-sm text-sm text-fg-muted">
          That link doesn&apos;t point anywhere. It may have moved, or the address may be mistyped.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button variant="primary" asChild>
          <Link to="/report">Report an emergency</Link>
        </Button>
        <Button variant="secondary" asChild>
          <Link to="/">Back to home</Link>
        </Button>
      </div>
    </main>
  );
}

import { cn } from '../../lib/cn';

/**
 * The CrisisMap mark (CRIS-54).
 *
 * A map pin with two signal arcs radiating from it — the product in one glyph:
 * a located incident, broadcasting. Drawn as inline SVG rather than an image
 * file so it inherits `currentColor`, needs no network request on the citizen
 * path, and stays crisp at the 20px the top bar renders it at.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={cn('size-5', className)}>
      {/* Pin body: a teardrop, filled so it holds up at small sizes where a
          stroked outline would close up into a blob. */}
      <path
        d="M12 21.5s6.5-6.06 6.5-10.5a6.5 6.5 0 1 0-13 0c0 4.44 6.5 10.5 6.5 10.5Z"
        fill="currentColor"
      />
      {/* Knocked-out centre rather than a second filled dot, so the hole shows
          the surface behind it and the mark works on any background. */}
      <circle cx="12" cy="11" r="2.35" className="fill-surface" />
      {/* Signal arcs. Progressively faded to read as propagation, not as three
          concentric rings of equal weight. */}
      <path
        d="M4.4 4.9a10.6 10.6 0 0 1 15.2 0"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        opacity="0.45"
      />
      <path
        d="M7.6 2.1a15 15 0 0 1 8.8 0"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        opacity="0.2"
      />
    </svg>
  );
}

/**
 * Mark + wordmark lockup.
 *
 * The whole lockup carries ONE accessible name ("CrisisMap AI") via the text
 * node; the mark stays `aria-hidden` so the product name is not announced twice
 * in a row on every page.
 */
export function Logo({
  className,
  showWordmark = true,
}: {
  className?: string;
  showWordmark?: boolean;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span className="flex size-7 shrink-0 items-center justify-center rounded bg-accent text-fg-on-solid">
        <LogoMark />
      </span>
      {showWordmark ? (
        <span className="text-[15px] font-semibold tracking-tight text-fg">
          CrisisMap<span className="text-accent"> AI</span>
        </span>
      ) : (
        <span className="sr-only">CrisisMap AI</span>
      )}
    </span>
  );
}

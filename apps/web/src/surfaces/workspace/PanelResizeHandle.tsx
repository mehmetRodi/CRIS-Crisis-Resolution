import { useRef } from 'react';
import { GripVertical } from 'lucide-react';

const MIN_WIDTH = 240;
const MAX_WIDTH = 480;

/** Pointer capture keeps a drag working when the pointer passes over the map. */
export function PanelResizeHandle({
  label,
  controls,
  width,
  direction = 1,
  onResize,
}: {
  label: string;
  controls: string;
  width: number;
  direction?: 1 | -1;
  onResize: (width: number) => void;
}) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  function resize(value: number) {
    onResize(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, value)));
  }
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-controls={controls}
      aria-orientation="vertical"
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      aria-valuenow={width}
      aria-valuetext={`${width} pixels preferred width`}
      title="Drag to resize, or use the arrow keys"
      className="z-10 flex w-3 shrink-0 touch-none cursor-col-resize items-center justify-center border-x border-border/60 bg-bg text-fg-muted transition-colors hover:bg-accent-subtle hover:text-accent focus-visible:bg-accent-subtle"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width };
        event.currentTarget.focus();
      }}
      onPointerMove={(event) => {
        if (drag.current) resize(drag.current.width + (event.clientX - drag.current.x) * direction);
      }}
      onPointerUp={(event) => {
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        resize(
          event.key === 'Home'
            ? MIN_WIDTH
            : event.key === 'End'
              ? MAX_WIDTH
              : width + (event.key === 'ArrowRight' ? 20 : -20) * direction,
        );
      }}
    >
      <GripVertical aria-hidden="true" className="h-5 w-3" />
    </div>
  );
}

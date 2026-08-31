import { ReportForm } from '../components/ReportForm';
import { CitizenShell } from '../shell/CitizenShell';

/**
 * The citizen report surface (`/report`, ADR-0021, restyled in CRIS-54).
 *
 * Mounted in `CitizenShell` rather than the operational `AppShell`: no
 * navigation, no role chip, no live-connection indicator, no account menu.
 * Somebody filing a report is doing one thing, once, and every additional
 * control is a place to get lost on the way to it.
 *
 * Mobile remains the primary citizen channel (ADR-0020); this is the browser
 * fallback, because an emergency leaves no time to install an app.
 */
export function ReportPage() {
  return (
    <CitizenShell
      title="Report an emergency"
      description="Describe what is happening. It goes straight to emergency coordinators — no account needed, and you can stay anonymous."
    >
      <ReportForm />
    </CitizenShell>
  );
}

import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, ShieldCheck } from 'lucide-react';
import { CitizenShell } from '../shell/CitizenShell';
import { Button } from '../components/ui/button';

const pages = {
  about: {
    eyebrow: 'A clearer picture. A coordinated response.',
    title: 'Built around people who help.',
    description: 'CRIS connects community reports with the people coordinating a response.',
    sections: [
      [
        'Share what you see',
        'Anyone can report an incident without creating an account. A description, location, and optional photo help coordinators understand what is happening.',
      ],
      [
        'Turn information into action',
        'Automated triage helps organise reports by category and priority. Coordinators review incidents, update their status, and assign response teams.',
      ],
      [
        'Find your focus',
        'Volunteers can browse tasks by region, team, and category, open task details, and check available locations on the map. Public maps show confirmed incidents.',
      ],
    ],
  },
  help: {
    eyebrow: 'Help & guidance',
    title: 'A little guidance goes a long way.',
    description:
      'Find your next step, whether you are reporting an incident or supporting a response.',
    sections: [
      [
        'How do I send a report?',
        'Open New report, describe the situation, choose a category and urgency, then continue through location and optional details. Review your entries before sending. You can return to any card to make changes.',
      ],
      [
        'What if I lose connection?',
        'When you send a report offline, CRIS attempts to save it on this device for retry. “Report saved” means it has not reached coordinators yet. Keep CRIS open, or reopen it on this device when online. A photo that failed to upload will not be attached.',
      ],
      [
        'How do I find relevant tasks?',
        'Open Tasks in your workspace. Choose your region or team, search by summary, and use Active tasks to focus on unfinished work. Use My tasks to see reports you have claimed or a coordinator has assigned to you. Choosing a team filter does not join that team.',
      ],
      [
        'Why is a task missing from the map?',
        'Only confirmed incidents with published coordinates can appear in task maps. If a location is unavailable, check with your coordinator. Open the task and use Claim report to take responsibility for a verified report. You can then add progress updates. Opening a task alone does not change it.',
      ],
      [
        'How do I get workspace access?',
        'Sign in with your team account. Workspace access depends on your assigned role. If your account has no operational role, contact the administrator who manages your deployment.',
      ],
    ],
  },
  privacy: {
    eyebrow: 'Privacy guide',
    title: 'Share the incident thoughtfully.',
    description: 'Understand what you share and what appears in the different CRIS views.',
    sections: [
      [
        'Descriptions and photos',
        'Keep names, phone numbers, and other personal details out of descriptions and photos. Describe the incident and the help needed. Your report is processed to support triage and coordinator review.',
      ],
      [
        'Contact and anonymous reporting',
        'Contact details are optional. You can choose anonymous reporting on the Details card. Public incident and volunteer task views exclude reporter identity and contact fields.',
      ],
      [
        'Location on the map',
        'When you provide a location, it helps teams understand where the incident is. Confirmed incidents may appear on the public map with their published location and summary. Avoid including a private location unless it is needed to describe the incident.',
      ],
      [
        'Information on your device',
        'Reports queued offline are saved on the device for retry. Contact details are omitted from that offline copy. Task view preferences are kept for the current visit. Avoid using a shared device for sensitive reports.',
      ],
      [
        'Questions about your data',
        'CRIS can be operated by different organisations. Contact the organisation running your deployment for its retention practices, privacy contact, and requests about your data. This guide describes the application flow and does not replace that organisation’s privacy notice.',
      ],
    ],
  },
  terms: {
    eyebrow: 'Terms of use',
    title: 'Use CRIS with care.',
    description: 'Practical conditions for reporting and coordinating through this application.',
    sections: [
      [
        'Emergency assistance',
        'CRIS supports incident reporting and coordination. It does not guarantee that a report will be reviewed immediately or that help will be dispatched. If there is immediate danger, contact your local emergency service.',
      ],
      [
        'Responsible reporting',
        'Share information you believe to be accurate. Distinguish what you observed from what you heard. Do not submit deliberately misleading reports or content you do not have permission to share.',
      ],
      [
        'Working with incident information',
        'Reports and automated assessments may be incomplete, delayed, or incorrect. Follow your organisation’s procedures and coordinator instructions before acting. A map point is incident context, not a verified route or an instruction to travel.',
      ],
      [
        'Accounts and access',
        'Use only accounts and roles authorised for you. Keep credentials private and respect the access boundaries for reporter and operational information.',
      ],
      [
        'Deployment-specific terms',
        'Additional terms may be provided by the organisation operating your CRIS deployment. Contact that organisation for its service policies and support arrangements.',
      ],
    ],
  },
} as const;

export type InformationPageKind = keyof typeof pages;

export function InformationPage({ kind }: { kind: InformationPageKind }) {
  const page = pages[kind];
  return (
    <CitizenShell>
      <div className="mb-8">
        <span className="mb-5 inline-flex size-12 items-center justify-center rounded-2xl border border-accent-border bg-accent-subtle text-accent">
          <BookOpen aria-hidden="true" className="size-5" />
        </span>
        <p className="text-xs font-semibold uppercase tracking-widest text-accent">
          {page.eyebrow}
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">{page.title}</h1>
        <p className="mt-4 text-base leading-relaxed text-fg-muted">{page.description}</p>
      </div>
      <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface shadow-xs">
        {page.sections.map(([title, body], index) => (
          <section key={title} className="p-5 sm:p-7">
            <p className="mb-3 text-xs font-medium text-accent">
              {String(index + 1).padStart(2, '0')}
            </p>
            <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
            <p className="mt-3 text-sm leading-7 text-fg-muted">{body}</p>
          </section>
        ))}
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-4 rounded-2xl bg-accent-subtle p-5">
        <ShieldCheck className="size-5 text-accent" aria-hidden="true" />
        <p className="flex-1 text-sm font-medium">Ready to share what is happening?</p>
        <Button asChild>
          <Link to="/report">
            New report
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </CitizenShell>
  );
}

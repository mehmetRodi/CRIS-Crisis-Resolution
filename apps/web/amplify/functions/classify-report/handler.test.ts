import { describe, expect, it, vi } from 'vitest';
import {
  CLASSIFICATION_CONTRACT_VERSION,
  Category,
  ReportStatus,
  Urgency,
  type ClassificationResult,
} from '@crisismap/shared';
import { parseMessage, processRecord, type WorkerDeps } from './handler';
import type {
  LocationResult,
  MarkNeedsVerificationInput,
  PersistClassificationInput,
  ReportRecord,
  ReportStore,
} from './store';
import { ClassificationError } from './bedrock';
import type { TriageAgent, TriageResult } from './agent';

const CLASSIFICATION: ClassificationResult = {
  contractVersion: CLASSIFICATION_CONTRACT_VERSION,
  category: Category.MEDICAL,
  urgency: Urgency.CRITICAL,
  confidence: 0.9,
  locationHint: 'the downtown clinic',
  summary: 'Injured people at a clinic.',
  rationale: 'Multiple casualties reported at a medical facility.',
  needsHumanReview: false,
  entities: { peopleAffected: 4, infrastructure: ['downtown clinic'], hazards: [] },
};

const LOCATION: LocationResult = { lat: 40.71, lng: -74.0, geohash: 'dr5reg', geohashPrefix: 'dr5re' };

function fakeStore(report: ReportRecord | null, claim = true) {
  const persisted: PersistClassificationInput[] = [];
  const flagged: MarkNeedsVerificationInput[] = [];
  const store: ReportStore = {
    getReport: vi.fn(async () => report),
    claimProcessing: vi.fn(async () => claim),
    persistClassification: vi.fn(async (input) => {
      persisted.push(input);
    }),
    markNeedsVerification: vi.fn(async (input) => {
      flagged.push(input);
    }),
  };
  return { store, persisted, flagged };
}

function fakeAgent(impl?: TriageAgent['triage']): TriageAgent {
  return {
    triage: vi.fn(impl ?? (async (): Promise<TriageResult> => ({ classification: CLASSIFICATION, location: null }))),
  };
}

const NEW_REPORT: ReportRecord = {
  id: 'r1',
  version: 3,
  status: ReportStatus.NEW,
  text: 'people hurt at the clinic',
  lastProcessedEventId: null,
};

const message = { reportId: 'r1', version: 3, streamEventId: 'evt-1' };
const deps = (store: ReportStore, triage: TriageAgent): WorkerDeps => ({
  store,
  triage,
  log: () => {},
});

describe('parseMessage', () => {
  it('parses a well-formed message', () => {
    expect(parseMessage(JSON.stringify(message))).toEqual(message);
  });

  it('coerces the pipe-projected string version to a number', () => {
    expect(parseMessage('{"reportId":"r1","version":"7","streamEventId":"e"}')).toEqual({
      reportId: 'r1',
      version: 7,
      streamEventId: 'e',
    });
  });

  it('returns null for poison payloads', () => {
    expect(parseMessage('not json')).toBeNull();
    expect(parseMessage('{"reportId":"r1"}')).toBeNull();
    expect(parseMessage('{"reportId":1,"version":1,"streamEventId":"e"}')).toBeNull();
  });
});

describe('processRecord', () => {
  it('classifies a NEW report and persists the deterministic score', async () => {
    const { store, persisted, flagged } = fakeStore(NEW_REPORT);
    const agent = fakeAgent();

    await processRecord(deps(store, agent), message);

    expect(store.claimProcessing).toHaveBeenCalledWith('r1', 3);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      reportId: 'r1',
      claimedVersion: 4,
      streamEventId: 'evt-1',
      status: ReportStatus.AI_CLASSIFIED,
      classification: { category: Category.MEDICAL, urgency: Urgency.CRITICAL },
      // MEDICAL + CRITICAL at age 0 ⇒ 5 + 3 + 1.5 = 9.5 ⇒ P0 (§5.4.2).
      priorityBand: 'P0',
    });
    expect(persisted[0].scoreBreakdown.urgencyWeight).toBe(5);
    // Entities extracted by the Triage Agent are carried through to the store (CRIS-20).
    expect(persisted[0].classification.entities.peopleAffected).toBe(4);
    expect(flagged).toHaveLength(0);
  });

  it('persists the location resolved by the Triage Agent geocode tool (§5.5)', async () => {
    const { store, persisted } = fakeStore(NEW_REPORT);
    const agent = fakeAgent(async () => ({ classification: CLASSIFICATION, location: LOCATION }));

    await processRecord(deps(store, agent), message);

    expect(persisted).toHaveLength(1);
    expect(persisted[0].location).toEqual(LOCATION);
  });

  it('escalates a model-flagged classification to NEEDS_VERIFICATION but still records it (§2.6)', async () => {
    const { store, persisted, flagged } = fakeStore(NEW_REPORT);
    const agent = fakeAgent(async () => ({
      classification: { ...CLASSIFICATION, needsHumanReview: true },
      location: null,
    }));

    await processRecord(deps(store, agent), message);

    expect(persisted).toHaveLength(1);
    expect(persisted[0].status).toBe(ReportStatus.NEEDS_VERIFICATION);
    expect(flagged).toHaveLength(0);
  });

  it('escalates a low-confidence classification to NEEDS_VERIFICATION (§2.6)', async () => {
    const { store, persisted } = fakeStore(NEW_REPORT);
    const agent = fakeAgent(async () => ({
      classification: { ...CLASSIFICATION, confidence: 0.2 },
      location: null,
    }));

    await processRecord(deps(store, agent), message);

    expect(persisted).toHaveLength(1);
    expect(persisted[0].status).toBe(ReportStatus.NEEDS_VERIFICATION);
  });

  it('is idempotent when the stream event was already applied', async () => {
    const { store, persisted } = fakeStore({ ...NEW_REPORT, lastProcessedEventId: 'evt-1' });
    await processRecord(deps(store, fakeAgent()), message);
    expect(store.claimProcessing).not.toHaveBeenCalled();
    expect(persisted).toHaveLength(0);
  });

  it('skips reports that are no longer NEW', async () => {
    const { store, persisted } = fakeStore({ ...NEW_REPORT, status: ReportStatus.AI_CLASSIFIED });
    await processRecord(deps(store, fakeAgent()), message);
    expect(store.claimProcessing).not.toHaveBeenCalled();
    expect(persisted).toHaveLength(0);
  });

  it('does nothing when the claim race is lost', async () => {
    const { store, persisted } = fakeStore(NEW_REPORT, false);
    await processRecord(deps(store, fakeAgent()), message);
    expect(persisted).toHaveLength(0);
  });

  it('is a no-op when the report no longer exists', async () => {
    const { store, persisted } = fakeStore(null);
    await processRecord(deps(store, fakeAgent()), message);
    expect(store.claimProcessing).not.toHaveBeenCalled();
    expect(persisted).toHaveLength(0);
  });

  it('marks NEEDS_VERIFICATION when triage fails (§5.4.4)', async () => {
    const { store, persisted, flagged } = fakeStore(NEW_REPORT);
    // Both the agent and its single-call fallback failed contract validation.
    const agent = fakeAgent(async () => {
      throw new ClassificationError(['invalid category: ...']);
    });

    await processRecord(deps(store, agent), message);

    expect(persisted).toHaveLength(0);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toMatchObject({
      reportId: 'r1',
      claimedVersion: 4,
      reason: 'classification_failed',
    });
  });
});

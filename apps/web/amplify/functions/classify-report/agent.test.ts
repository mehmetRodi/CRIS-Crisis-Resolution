import { describe, expect, it, vi } from 'vitest';
import { Category, Urgency } from '@crisismap/shared';
import {
  createBedrockTriageAgent,
  createTriageAgent,
  runTriage,
  TriageOrchestrationError,
  type Invoke,
  type TriageAgent,
  type TriageResult,
} from './agent';
import { ClassificationError, type Classifier } from './bedrock';
import { createNullGeocoder, type Geocoder } from './geocode';
import type { LocationResult } from './store';

/* -------------------------------------------------------------------------- */
/* Fixtures & fakes                                                            */
/* -------------------------------------------------------------------------- */

const VALID_TRIAGE_INPUT = {
  category: Category.MEDICAL,
  urgency: Urgency.CRITICAL,
  confidence: 0.9,
  locationHint: 'north bridge on Route 9',
  summary: 'Injured person, needs medical evac.',
  rationale: 'Explicit mention of injury and entrapment.',
  needsHumanReview: false,
  entities: { peopleAffected: 3, infrastructure: ['north bridge'], hazards: ['road blocked'] },
};

const RESOLVED: LocationResult = { lat: 40.71, lng: -74.0, geohash: 'dr5reg', geohashPrefix: 'dr5re' };

interface BedrockBody {
  content?: { type: string; [k: string]: unknown }[];
  stop_reason?: string;
}

function submitResponse(input: Record<string, unknown>): BedrockBody {
  return { content: [{ type: 'tool_use', id: 's1', name: 'submit_triage', input }], stop_reason: 'tool_use' };
}

function geocodeResponse(query: string, id = 'g1'): BedrockBody {
  return {
    content: [{ type: 'tool_use', id, name: 'geocode_location', input: { query } }],
    stop_reason: 'tool_use',
  };
}

function textResponse(): BedrockBody {
  return { content: [{ type: 'text', text: 'here is your answer' }], stop_reason: 'end_turn' };
}

/** An Invoke that returns queued responses in order; over-running is a test failure. */
function scripted(responses: BedrockBody[]): Invoke {
  const queue = [...responses];
  return vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error('scripted invoke exhausted — loop ran longer than expected');
    return next;
  });
}

function fakeGeocoder(result: LocationResult | null, throws = false): Geocoder {
  return {
    geocode: vi.fn(async () => {
      if (throws) throw new Error('place index unreachable');
      return result;
    }),
  };
}

/* -------------------------------------------------------------------------- */
/* runTriage — the tool-use loop                                               */
/* -------------------------------------------------------------------------- */

describe('runTriage', () => {
  it('classifies directly when the model submits without geocoding', async () => {
    const geocoder = fakeGeocoder(RESOLVED);
    const result = await runTriage(
      { invoke: scripted([submitResponse(VALID_TRIAGE_INPUT)]), geocoder },
      'people hurt at the clinic',
    );

    expect(result.classification.category).toBe(Category.MEDICAL);
    expect(result.classification.entities.peopleAffected).toBe(3);
    expect(result.location).toBeNull();
    expect(geocoder.geocode).not.toHaveBeenCalled();
  });

  it('captures the geocode tool result as the authoritative location', async () => {
    const geocoder = fakeGeocoder(RESOLVED);
    const result = await runTriage(
      {
        invoke: scripted([geocodeResponse('north bridge on Route 9'), submitResponse(VALID_TRIAGE_INPUT)]),
        geocoder,
      },
      'collapse near the north bridge',
    );

    expect(geocoder.geocode).toHaveBeenCalledWith('north bridge on Route 9');
    // Location comes from the tool's real return value, not the model's echo.
    expect(result.location).toEqual(RESOLVED);
    expect(result.classification.category).toBe(Category.MEDICAL);
  });

  it('proceeds unlocated when the geocoder resolves nothing (GEOCODING_ENABLED=false)', async () => {
    const result = await runTriage(
      {
        invoke: scripted([geocodeResponse('somewhere vague'), submitResponse(VALID_TRIAGE_INPUT)]),
        geocoder: createNullGeocoder(),
      },
      'help somewhere',
    );
    expect(result.location).toBeNull();
    expect(result.classification.category).toBe(Category.MEDICAL);
  });

  it('treats a geocode failure as non-fatal and continues', async () => {
    const result = await runTriage(
      {
        invoke: scripted([geocodeResponse('north bridge'), submitResponse(VALID_TRIAGE_INPUT)]),
        geocoder: fakeGeocoder(null, true),
      },
      'collapse near the north bridge',
    );
    expect(result.location).toBeNull();
    expect(result.classification.urgency).toBe(Urgency.CRITICAL);
  });

  it('repairs invalid triage exactly once, then succeeds', async () => {
    const invalid = { ...VALID_TRIAGE_INPUT, category: 'EARTHQUAKE' };
    const result = await runTriage(
      {
        invoke: scripted([submitResponse(invalid), submitResponse(VALID_TRIAGE_INPUT)]),
        geocoder: fakeGeocoder(null),
      },
      'shaking building',
    );
    expect(result.classification.category).toBe(Category.MEDICAL);
  });

  it('gives up with ClassificationError after the repair also fails (→ NEEDS_VERIFICATION)', async () => {
    const invalid = { ...VALID_TRIAGE_INPUT, urgency: 'EXTREME' };
    await expect(
      runTriage(
        { invoke: scripted([submitResponse(invalid), submitResponse(invalid)]), geocoder: fakeGeocoder(null) },
        'ambiguous report',
      ),
    ).rejects.toBeInstanceOf(ClassificationError);
  });

  it('raises TriageOrchestrationError when Bedrock invoke throws', async () => {
    const invoke: Invoke = vi.fn(async () => {
      throw new Error('bedrock 500');
    });
    await expect(runTriage({ invoke, geocoder: fakeGeocoder(null) }, 'x')).rejects.toBeInstanceOf(
      TriageOrchestrationError,
    );
  });

  it('raises TriageOrchestrationError when the model answers with no tool call', async () => {
    await expect(
      runTriage({ invoke: scripted([textResponse()]), geocoder: fakeGeocoder(null) }, 'x'),
    ).rejects.toBeInstanceOf(TriageOrchestrationError);
  });

  it('raises TriageOrchestrationError when the loop never converges', async () => {
    // Model keeps geocoding and never submits — bounded by MAX_TURNS.
    const geocoding = Array.from({ length: 6 }, (_, i) => geocodeResponse('loop', `g${i}`));
    await expect(
      runTriage({ invoke: scripted(geocoding), geocoder: fakeGeocoder(null) }, 'x'),
    ).rejects.toBeInstanceOf(TriageOrchestrationError);
  });
});

/* -------------------------------------------------------------------------- */
/* createBedrockTriageAgent — InvokeModel body wiring                          */
/* -------------------------------------------------------------------------- */

describe('createBedrockTriageAgent', () => {
  it('decodes an InvokeModel tool-use response into a TriageResult', async () => {
    const send = vi.fn(async () => ({
      body: new TextEncoder().encode(JSON.stringify(submitResponse(VALID_TRIAGE_INPUT))),
    }));
    const agent = createBedrockTriageAgent({
      modelId: 'eu.anthropic.claude-haiku-4-5-20251001-v1:0',
      geocoder: createNullGeocoder(),
      // Minimal fake client — only `.send` is exercised.
      client: { send } as never,
    });

    const result = await agent.triage('injured people');
    expect(result.classification.category).toBe(Category.MEDICAL);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

/* -------------------------------------------------------------------------- */
/* createTriageAgent — degradation to the single-call classifier (§5.5)        */
/* -------------------------------------------------------------------------- */

describe('createTriageAgent (degradation)', () => {
  const FALLBACK_RESULT = { ...VALID_TRIAGE_INPUT, category: Category.FIRE } as unknown;

  function fakePrimary(err: Error): TriageAgent {
    return {
      triage: vi.fn(async () => {
        throw err;
      }),
    };
  }

  it('falls back to the single-call classifier on orchestration failure', async () => {
    const fallback: Classifier = {
      classify: vi.fn(async () => ({ ...VALID_TRIAGE_INPUT, category: Category.FIRE }) as never),
    };
    const agent = createTriageAgent({
      primary: fakePrimary(new TriageOrchestrationError('bedrock down')),
      fallback,
    });

    const result: TriageResult = await agent.triage('fire report');
    expect(fallback.classify).toHaveBeenCalledWith('fire report');
    expect(result.classification.category).toBe(Category.FIRE);
    expect(result.location).toBeNull();
  });

  it('does NOT fall back on a ClassificationError — it routes to NEEDS_VERIFICATION', async () => {
    const fallback: Classifier = { classify: vi.fn(async () => FALLBACK_RESULT as never) };
    const agent = createTriageAgent({
      primary: fakePrimary(new ClassificationError(['invalid category'])),
      fallback,
    });

    await expect(agent.triage('x')).rejects.toBeInstanceOf(ClassificationError);
    expect(fallback.classify).not.toHaveBeenCalled();
  });
});

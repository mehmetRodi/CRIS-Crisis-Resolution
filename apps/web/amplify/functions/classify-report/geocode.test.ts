import { describe, expect, it, vi } from 'vitest';
import { GeocodeCommand, type GeocodeCommandOutput } from '@aws-sdk/client-geo-places';
import { encodeGeohash, geohashPrefix } from '@crisismap/shared';
import { createAmazonLocationGeocoder, createNullGeocoder, type GeoPlacesSend } from './geocode';

/* -------------------------------------------------------------------------- */
/* Fakes                                                                       */
/* -------------------------------------------------------------------------- */

/** A GeoPlaces client that returns a scripted response (or throws) for `send`. */
function fakeClient(
  result: GeocodeCommandOutput | (() => Promise<GeocodeCommandOutput>),
): GeoPlacesSend & { send: ReturnType<typeof vi.fn> } {
  return {
    send: vi.fn(async () => (typeof result === 'function' ? result() : result)),
  };
}

/** A `GeocodeResponse` with one result at [lng, lat] and an optional match score. */
function oneResult(lng: number, lat: number, score?: number): GeocodeCommandOutput {
  return {
    $metadata: {},
    PricingBucket: 'test',
    ResultItems: [
      {
        PlaceId: 'p1',
        PlaceType: 'PointAddress',
        Title: 'Somewhere',
        Position: [lng, lat],
        ...(score === undefined ? {} : { MatchScores: { Overall: score } }),
      },
    ],
  } as GeocodeCommandOutput;
}

/* -------------------------------------------------------------------------- */
/* createNullGeocoder                                                          */
/* -------------------------------------------------------------------------- */

describe('createNullGeocoder', () => {
  it('always resolves nothing', async () => {
    await expect(createNullGeocoder().geocode('Kadikoy pier')).resolves.toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* createAmazonLocationGeocoder                                                */
/* -------------------------------------------------------------------------- */

describe('createAmazonLocationGeocoder', () => {
  it('resolves a query to coordinates + derived geohash', async () => {
    const client = fakeClient(oneResult(29.0257, 40.9903, 0.95)); // Kadikoy, Istanbul
    const geocoder = createAmazonLocationGeocoder({ client });

    const result = await geocoder.geocode('Kadikoy pier, Istanbul');

    const geohash = encodeGeohash(40.9903, 29.0257);
    expect(result).toEqual({
      lat: 40.9903,
      lng: 29.0257,
      geohash,
      geohashPrefix: geohashPrefix(geohash),
    });
  });

  it('maps Position [lng, lat] to lat/lng without swapping', async () => {
    const client = fakeClient(oneResult(29.0257, 40.9903, 0.95));
    const result = await createAmazonLocationGeocoder({ client }).geocode('somewhere');
    // lat must be the second array element, lng the first.
    expect(result?.lat).toBe(40.9903);
    expect(result?.lng).toBe(29.0257);
  });

  it('sends QueryText with IntendedUse=Storage and a single result', async () => {
    const client = fakeClient(oneResult(29.0257, 40.9903, 0.95));
    await createAmazonLocationGeocoder({ client }).geocode('  Kadikoy pier  ');

    expect(client.send).toHaveBeenCalledTimes(1);
    const command = client.send.mock.calls[0][0] as GeocodeCommand;
    expect(command).toBeInstanceOf(GeocodeCommand);
    expect(command.input).toMatchObject({
      QueryText: 'Kadikoy pier', // trimmed
      MaxResults: 1,
      IntendedUse: 'Storage',
    });
  });

  it('returns null for an empty query without calling the API', async () => {
    const client = fakeClient(oneResult(29.0257, 40.9903, 0.95));
    await expect(createAmazonLocationGeocoder({ client }).geocode('   ')).resolves.toBeNull();
    expect(client.send).not.toHaveBeenCalled();
  });

  it('returns null when the API finds no match', async () => {
    const client = fakeClient({ $metadata: {}, ResultItems: [] } as GeocodeCommandOutput);
    await expect(createAmazonLocationGeocoder({ client }).geocode('nowhere')).resolves.toBeNull();
  });

  it('returns null when the top result has no usable Position', async () => {
    const client = fakeClient({
      $metadata: {},
      ResultItems: [{ PlaceId: 'p1', PlaceType: 'Region', Title: 'X' }],
    } as GeocodeCommandOutput);
    await expect(
      createAmazonLocationGeocoder({ client }).geocode('vague area'),
    ).resolves.toBeNull();
  });

  it('discards a low-confidence match below the score floor', async () => {
    const client = fakeClient(oneResult(29.0257, 40.9903, 0.3));
    await expect(
      createAmazonLocationGeocoder({ client }).geocode('maybe here'),
    ).resolves.toBeNull();
  });

  it('accepts a result that omits a match score (score is a guard, not required)', async () => {
    const client = fakeClient(oneResult(29.0257, 40.9903));
    await expect(
      createAmazonLocationGeocoder({ client }).geocode('scoreless place'),
    ).resolves.not.toBeNull();
  });

  it('honours a custom minMatchScore', async () => {
    const client = fakeClient(oneResult(29.0257, 40.9903, 0.6));
    await expect(
      createAmazonLocationGeocoder({ client, minMatchScore: 0.9 }).geocode('borderline'),
    ).resolves.toBeNull();
  });

  it('propagates a genuine API error (agent treats it as unavailable)', async () => {
    const client = fakeClient(async () => {
      throw new Error('ThrottlingException');
    });
    await expect(createAmazonLocationGeocoder({ client }).geocode('anywhere')).rejects.toThrow(
      'ThrottlingException',
    );
  });
});

import { describe, expect, it } from 'vitest';
import { encodeGeohash, geohashPrefix, GEOHASH_PREFIX_PRECISION } from './geohash';
import { GEOHASH_PRECISION } from './domain';

describe('encodeGeohash', () => {
  it('matches the canonical geohash reference value', () => {
    // The Wikipedia worked example: (57.64911, 10.40744) → "u4pruydqqvj".
    expect(encodeGeohash(57.64911, 10.40744, 11)).toBe('u4pruydqqvj');
  });

  it('defaults to the §5.2 report precision', () => {
    const hash = encodeGeohash(57.64911, 10.40744);
    expect(hash).toHaveLength(GEOHASH_PRECISION);
    expect(hash).toBe('u4pruyd');
  });

  it('is a strict prefix relationship as precision grows', () => {
    const coarse = encodeGeohash(41.0082, 28.9784, 5); // Istanbul
    const fine = encodeGeohash(41.0082, 28.9784, 9);
    expect(fine.startsWith(coarse)).toBe(true);
  });

  it('handles the coordinate-system extremes', () => {
    expect(encodeGeohash(0, 0, 1)).toBe('s');
    expect(() => encodeGeohash(90, 180, 7)).not.toThrow();
    expect(() => encodeGeohash(-90, -180, 7)).not.toThrow();
  });

  it('rejects out-of-range or non-finite coordinates', () => {
    expect(() => encodeGeohash(91, 0)).toThrow(RangeError);
    expect(() => encodeGeohash(0, 181)).toThrow(RangeError);
    expect(() => encodeGeohash(Number.NaN, 0)).toThrow(RangeError);
    expect(() => encodeGeohash(0, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('rejects a non-positive-integer precision', () => {
    expect(() => encodeGeohash(0, 0, 0)).toThrow(RangeError);
    expect(() => encodeGeohash(0, 0, 1.5)).toThrow(RangeError);
  });
});

describe('geohashPrefix', () => {
  it('takes the leading prefix-precision characters by default', () => {
    const hash = encodeGeohash(57.64911, 10.40744); // "u4pruyd"
    const prefix = geohashPrefix(hash);
    expect(prefix).toHaveLength(GEOHASH_PREFIX_PRECISION);
    expect(prefix).toBe('u4pru');
    expect(hash.startsWith(prefix)).toBe(true);
  });

  it('throws when the geohash is shorter than the requested prefix', () => {
    expect(() => geohashPrefix('u4p')).toThrow(RangeError);
  });
});

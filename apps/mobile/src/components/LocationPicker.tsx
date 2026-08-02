import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeSyntheticEvent } from 'react-native';
import {
  Camera,
  Map,
  Marker,
  type CameraRef,
  type ViewStateChangeEvent,
} from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import type { ReportLocation } from '@crisismap/shared';

import { colors, radii } from '../theme';

/**
 * OpenFreeMap's "Liberty" style — full OSM vector data (place names down to
 * village level, roads, buildings), free and keyless, no rate limit. Same
 * choice as the web picker's shared `surfaces/map/mapStyle.ts`; MapLibre's own
 * demo style (`demotiles.maplibre.org`) is bare country outlines, unusable for
 * actually placing a pin near a named place.
 *
 * Kept as a local constant rather than shared with web: this is a different
 * library (`@maplibre/maplibre-react-native` vs `maplibre-gl`) in a workspace
 * that can't import from `apps/web`. See ADR-0034.
 */
const DEMO_MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const DEFAULT_CENTER: ReportLocation = { lat: 20, lng: 0 };
const DEFAULT_ZOOM = 1.2;
const PIN_ZOOM = 15;

/** ~0.1 m — close enough that the crosshair is sitting on the committed pin. */
const COORD_EPSILON = 1e-6;

function isSameLocation(a: ReportLocation, b: ReportLocation | null): boolean {
  return (
    b !== null && Math.abs(a.lat - b.lat) < COORD_EPSILON && Math.abs(a.lng - b.lng) < COORD_EPSILON
  );
}

interface LocationPickerProps {
  value: ReportLocation | null;
  onChange: (location: ReportLocation | null) => void;
  /**
   * Fired on raw touch start/end over the map, before any pan gesture is
   * recognized. The parent screen uses this to disable its own ScrollView for
   * the duration of the touch, so the two don't fight over the same drag.
   */
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
}

/**
 * GPS + map-pin location input (CRIS-16), mobile twin of
 * apps/web/src/components/LocationPicker.tsx.
 *
 * The crosshair at the centre of the map is a *preview*, not a selection: you
 * pan the map to aim it, then press "Use this location" to commit. Panning
 * alone never writes a coordinate. That explicit step matters here — the map
 * opens zoomed out over the Atlantic, and an earlier revision committed the
 * map centre on every pan/pinch, so merely zooming in to look around silently
 * attached an ocean coordinate to an emergency report. A wrong coordinate on a
 * dispatch queue is worse than no coordinate.
 *
 * The committed pin renders as a real `Marker` at its own coordinate, so it
 * stays put while the crosshair moves, and disappears on Clear. MapLibre RN's
 * `Marker` has no drag handle (unlike the web `maplibregl.Marker`), which is
 * why aiming happens by panning rather than by dragging the pin.
 *
 * Location is always optional — an emergency report must never be blocked by
 * a denied permission or a bad GPS fix.
 *
 * MapLibre RN needs native code, so this component only runs in a custom
 * Expo dev-client build, not plain Expo Go (see ADR-0034). The free demo
 * style needs no API key until Amazon Location Service is wired
 * (CRIS-7/CRIS-24) — same approach as the web picker.
 */
export function LocationPicker({
  value,
  onChange,
  onInteractionStart,
  onInteractionEnd,
}: LocationPickerProps) {
  const cameraRef = useRef<CameraRef>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  /**
   * Where the crosshair currently points. Tracks every region change —
   * including programmatic ones like the GPS fly-to — because it only ever
   * describes the viewport, never the submitted value.
   */
  const [center, setCenter] = useState<ReportLocation>(value ?? DEFAULT_CENTER);

  function handleRegionDidChange(event: NativeSyntheticEvent<ViewStateChangeEvent>) {
    const [lng, lat] = event.nativeEvent.center;
    setCenter({ lat, lng });
  }

  async function useMyLocation() {
    setGpsError(null);
    setGpsLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setGpsError('Location permission denied. Aim the map and confirm instead.');
        return;
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const { latitude, longitude } = position.coords;
      // GPS is an explicit request for *this* coordinate, so it commits
      // directly — no second confirmation step.
      onChange({ lat: latitude, lng: longitude });
      cameraRef.current?.flyTo({ center: [longitude, latitude], zoom: PIN_ZOOM });
    } catch {
      setGpsError('Could not get your location. Aim the map and confirm instead.');
    } finally {
      setGpsLoading(false);
    }
  }

  const crosshairOnPin = isSameLocation(center, value);

  return (
    <View style={styles.container}>
      <View style={styles.actions}>
        <Pressable
          onPress={useMyLocation}
          disabled={gpsLoading}
          style={styles.gpsButton}
          accessibilityRole="button"
        >
          {gpsLoading ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Text style={styles.gpsButtonText}>📍 Use my location</Text>
          )}
        </Pressable>
        {value ? (
          <Pressable onPress={() => onChange(null)} hitSlop={8} accessibilityRole="button">
            <Text style={styles.clearText}>Clear</Text>
          </Pressable>
        ) : null}
      </View>

      <View
        style={styles.mapBox}
        testID="location-map"
        onTouchStart={onInteractionStart}
        onTouchEnd={onInteractionEnd}
        onTouchCancel={onInteractionEnd}
      >
        <Map style={styles.map} mapStyle={DEMO_MAP_STYLE} onRegionDidChange={handleRegionDidChange}>
          <Camera
            ref={cameraRef}
            initialViewState={
              value
                ? { center: [value.lng, value.lat], zoom: PIN_ZOOM }
                : { center: [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat], zoom: DEFAULT_ZOOM }
            }
          />
          {value ? (
            <Marker id="report-location" lngLat={[value.lng, value.lat]}>
              <View style={styles.pin} />
            </Marker>
          ) : null}
        </Map>
        {/* Aiming reticle, fixed at screen-centre; the map pans underneath it. */}
        <View pointerEvents="none" style={styles.crosshair} />
      </View>

      <Pressable
        onPress={() => onChange(center)}
        disabled={crosshairOnPin}
        style={[styles.confirmButton, crosshairOnPin && styles.confirmButtonDisabled]}
        accessibilityRole="button"
        accessibilityState={{ disabled: crosshairOnPin }}
      >
        <Text style={styles.confirmButtonText}>
          {value ? 'Move pin here' : 'Use this location'}
        </Text>
      </Pressable>

      <Text style={styles.hint}>
        {value
          ? `Pin at ${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}.`
          : `Aim the crosshair at ${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}, then confirm.`}
      </Text>
      {gpsError ? <Text style={styles.error}>{gpsError}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  gpsButton: {
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  gpsButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  clearText: {
    fontSize: 12,
    color: colors.textSecondary,
    textDecorationLine: 'underline',
  },
  mapBox: {
    height: 280,
    borderRadius: radii.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  map: {
    flex: 1,
  },
  crosshair: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 22,
    height: 22,
    marginLeft: -11,
    marginTop: -11,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: 'transparent',
  },
  pin: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  confirmButton: {
    borderRadius: radii.lg,
    backgroundColor: colors.primary,
    paddingVertical: 10,
    alignItems: 'center',
  },
  confirmButtonDisabled: {
    opacity: 0.5,
  },
  confirmButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  hint: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  error: {
    fontSize: 12,
    color: colors.errorText,
  },
});

import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeSyntheticEvent } from 'react-native';
import {
  Camera,
  Map,
  Marker,
  type CameraRef,
  type ViewStateChangeEvent,
} from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import { Crosshair, MapPin, X } from 'lucide-react-native';
import type { ReportLocation } from '@crisismap/shared';

import { colors, numeric, radii, space, srOnly, type } from '../theme';
import { Button } from './ui/Button';

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
        <Button
          label={gpsLoading ? 'Locating…' : 'Use my location'}
          onPress={useMyLocation}
          icon={Crosshair}
          loading={gpsLoading}
          // `blocked`, not `disabled`: disabling the control the user just
          // pressed removes it from the accessibility tree mid-interaction
          // (ADR-0037). `useMyLocation` holds the re-entry guard instead.
          blocked={gpsLoading}
          accessibilityLabel={gpsLoading ? 'Getting your location' : 'Use my location'}
        />
        {value ? (
          <Button
            label="Clear"
            onPress={() => onChange(null)}
            variant="ghost"
            icon={X}
            accessibilityLabel="Clear selected location"
          />
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
              <View style={styles.pin}>
                <View style={styles.pinCore} />
              </View>
            </Marker>
          ) : null}
        </Map>
        {/* Aiming reticle, fixed at screen-centre; the map pans underneath it.
            Purely decorative — the coordinate it points at is announced in the
            status line below, which is what a non-sighted user actually reads. */}
        <View pointerEvents="none" style={styles.crosshair}>
          <View style={styles.crosshairDot} />
        </View>
      </View>

      <Button
        label={value ? 'Move pin here' : 'Use this location'}
        onPress={() => onChange(center)}
        variant="primary"
        icon={MapPin}
        blocked={crosshairOnPin}
        accessibilityHint={
          crosshairOnPin
            ? 'The pin is already at the centre of the map. Pan the map to move it.'
            : undefined
        }
      />

      {/* Always rendered, in both states, so the live region exists before its
          text changes (ADR-0037) — that is what makes a committed pin audible
          rather than silent. */}
      <Text accessibilityLiveRegion="polite" style={styles.hint}>
        {value
          ? `Pin at ${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}.`
          : `Aim the crosshair at ${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}, then confirm.`}
      </Text>

      {/* Kept mounted for the same reason, and hidden while empty so an
          always-present region costs no layout. A denied permission is the most
          likely outcome of the button above; it must not fail quietly. */}
      <Text
        accessibilityLiveRegion="assertive"
        accessibilityRole="alert"
        style={gpsError ? styles.error : srOnly}
      >
        {gpsError ?? ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: space.md,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  mapBox: {
    height: 280,
    borderRadius: radii.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  map: {
    flex: 1,
  },
  crosshair: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 26,
    height: 26,
    marginLeft: -13,
    marginTop: -13,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.full,
    borderWidth: 2,
    borderColor: colors.accent,
    backgroundColor: 'transparent',
  },
  crosshairDot: {
    width: 4,
    height: 4,
    borderRadius: radii.full,
    backgroundColor: colors.accent,
  },
  pin: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.full,
    backgroundColor: colors.accent,
    // A light ring so the pin stays legible over dark map features.
    borderWidth: 3,
    borderColor: colors.surface,
  },
  pinCore: {
    width: 6,
    height: 6,
    borderRadius: radii.full,
    backgroundColor: colors.surface,
  },
  hint: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: colors.fgMuted,
    ...numeric,
  },
  error: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    fontWeight: '600',
    color: colors.danger,
  },
});

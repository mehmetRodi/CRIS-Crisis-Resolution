import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeSyntheticEvent } from 'react-native';
import {
  Camera,
  Map,
  type CameraRef,
  type ViewStateChangeEvent,
} from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import type { ReportLocation } from '@crisismap/shared';

import { colors, radii } from '../theme';

/**
 * OpenFreeMap's "Liberty" style — full OSM vector data (place names down to
 * village level, roads, buildings), free and keyless, no rate limit. Same
 * choice as the web picker's `lib/mapStyle.ts`; MapLibre's own demo style
 * (`demotiles.maplibre.org`) is bare country outlines, unusable for actually
 * placing a pin near a named place.
 */
const DEMO_MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const DEFAULT_CENTER: [number, number] = [0, 20];
const DEFAULT_ZOOM = 1.2;
const PIN_ZOOM = 15;

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
 * apps/web/src/components/LocationPicker.tsx. The pin is fixed at the center
 * of the map — pan/zoom the map underneath it to place it precisely, instead
 * of tapping an exact point. MapLibre RN's `Marker` has no drag handle
 * (unlike the web `maplibregl.Marker`), so tap-to-place was hard to fine-tune
 * on a touchscreen; a centered pin you pan under is the standard fix (same
 * pattern as most rideshare/delivery "confirm this location" flows) and
 * doesn't depend on marker-drag support at all.
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

  function handleRegionDidChange(event: NativeSyntheticEvent<ViewStateChangeEvent>) {
    // Ignore programmatic moves (e.g. the GPS button's flyTo) — only commit
    // when the person actually panned/pinched the map themselves.
    if (!event.nativeEvent.userInteraction) return;
    const [lng, lat] = event.nativeEvent.center;
    onChange({ lat, lng });
  }

  async function useMyLocation() {
    setGpsError(null);
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      setGpsError('Location permission denied. Pan the map to set a pin instead.');
      return;
    }
    setGpsLoading(true);
    try {
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const { latitude, longitude } = position.coords;
      onChange({ lat: latitude, lng: longitude });
      cameraRef.current?.flyTo({ center: [longitude, latitude], zoom: PIN_ZOOM });
    } catch {
      setGpsError('Could not get your location. Pan the map to set a pin instead.');
    } finally {
      setGpsLoading(false);
    }
  }

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
          <Pressable onPress={() => onChange(null)} hitSlop={8}>
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
                : { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM }
            }
          />
        </Map>
        {/* Fixed at screen-center; the map pans underneath it. */}
        <View pointerEvents="none" style={styles.centerPin} />
      </View>

      <Text style={styles.hint}>
        {value
          ? `Pin at ${value.lat.toFixed(5)}, ${value.lng.toFixed(5)} — pan the map to move it.`
          : 'Pan the map so the pin sits where you mean, or use your location above.'}
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
  centerPin: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 18,
    height: 18,
    marginLeft: -9,
    marginTop: -9,
    borderRadius: 9,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: '#ffffff',
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

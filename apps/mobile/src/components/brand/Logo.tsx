import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { colors, radii, space } from '../../theme';

/**
 * The CRIS mark (CRIS-57). Same geometry as
 * `apps/web/src/components/brand/Logo.tsx`, redrawn with `react-native-svg`.
 *
 * A map pin with two signal arcs radiating from it — the product in one glyph:
 * a located incident, broadcasting. Drawn as vectors rather than shipped as an
 * image so it stays crisp at every density and needs no asset pipeline.
 */
export function LogoMark({
  size = 20,
  color = colors.fgOnSolid,
}: {
  size?: number;
  color?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Pin body: a teardrop, filled so it holds up at small sizes where a
          stroked outline would close into a blob. */}
      <Path
        d="M12 21.5s6.5-6.06 6.5-10.5a6.5 6.5 0 1 0-13 0c0 4.44 6.5 10.5 6.5 10.5Z"
        fill={color}
      />
      {/* Knocked-out centre rather than a second filled dot, so the hole shows
          the tile behind it. */}
      <Circle cx="12" cy="11" r="2.35" fill={colors.accent} />
      {/* Signal arcs, progressively faded so they read as propagation rather
          than as three rings of equal weight. */}
      <Path
        d="M4.4 4.9a10.6 10.6 0 0 1 15.2 0"
        stroke={color}
        strokeWidth={1.7}
        strokeLinecap="round"
        opacity={0.45}
      />
      <Path
        d="M7.6 2.1a15 15 0 0 1 8.8 0"
        stroke={color}
        strokeWidth={1.7}
        strokeLinecap="round"
        opacity={0.2}
      />
    </Svg>
  );
}

/**
 * Mark + wordmark lockup.
 *
 * Grouped into ONE accessibility element naming the product, so the mark and
 * the mark and wordmark are announced together as "CRIS" rather than as two
 * separate nodes.
 */
export function Logo({ showWordmark = true }: { showWordmark?: boolean }) {
  return (
    <View style={styles.lockup} accessible accessibilityLabel="CRIS">
      <View style={styles.tile}>
        <LogoMark />
      </View>
      {showWordmark ? <Text style={styles.wordmark}>CRIS</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  lockup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  tile: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    backgroundColor: colors.accent,
  },
  wordmark: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
    color: colors.fg,
  },
});

import { StyleSheet, Text, View } from 'react-native';
import { CloudOff } from 'lucide-react-native';

import { useOfflineQueue } from '../lib/OfflineQueueContext';
import { colors, radii, space, srOnly, type } from '../theme';

/**
 * Persistent status banner for the offline report queue (CRIS-26, restyled in
 * CRIS-57). Web twin: `apps/web/src/components/OfflineQueueBanner.tsx`.
 *
 * Mounted unconditionally and only its CONTENT toggles (ADR-0037): assistive
 * tech reports changes to a live region it is already observing, so a region
 * inserted at the same moment as its message is commonly missed. When there is
 * nothing queued it collapses to a visually-hidden node that still holds its
 * place in the accessibility tree.
 */
export function OfflineQueueBanner() {
  const { pendingCount, isStale } = useOfflineQueue();

  if (pendingCount === 0) {
    return (
      <View
        style={srOnly}
        accessibilityLiveRegion="polite"
        accessibilityLabel="Offline queue status"
      />
    );
  }

  const noun = pendingCount === 1 ? 'report' : 'reports';
  const message = isStale
    ? `${pendingCount} ${noun} waiting to send — one has been waiting a long time and may need to be resent once you're back online.`
    : `${pendingCount} ${noun} waiting to send. They'll go out automatically once you're back online.`;

  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityLabel="Offline queue status"
      style={styles.banner}
    >
      <CloudOff size={18} color={colors.warning} style={styles.icon} />
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    backgroundColor: colors.warningSubtle,
    borderRadius: radii.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
  },
  icon: {
    marginTop: 1,
  },
  text: {
    flex: 1,
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    color: colors.fg,
  },
});

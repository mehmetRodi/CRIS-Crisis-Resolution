import { Text, View } from 'react-native';

import { useOfflineQueue } from '../lib/OfflineQueueContext';
import { colors, radii } from '../theme';

/**
 * Persistent status banner for the offline report queue (CRIS-26). Web twin:
 * `apps/web/src/components/OfflineQueueBanner.tsx`. Renders nothing when
 * there is nothing queued.
 */
export function OfflineQueueBanner() {
  const { pendingCount, isStale } = useOfflineQueue();

  if (pendingCount === 0) return null;

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
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = {
  banner: {
    borderWidth: 1,
    borderColor: colors.warningBorder,
    backgroundColor: colors.warningBg,
    borderRadius: radii.lg,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  text: {
    fontSize: 13,
    color: colors.warningText,
  },
} as const;

import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider } from './src/lib/AuthContext';
import { OfflineQueueProvider } from './src/lib/OfflineQueueContext';
import { RootNavigator } from './src/navigation/RootNavigator';
import { colors } from './src/theme';

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        {/* Root-level (CRIS-26), not per-screen: the flush loop and
            connectivity/AppState subscriptions must persist across
            navigation, not restart every time ReportScreen mounts. */}
        <OfflineQueueProvider>
          <RootNavigator />
        </OfflineQueueProvider>
      </AuthProvider>
      {/* Dark glyphs on the light canvas. `backgroundColor` applies on Android,
          where the status bar is a real surface rather than an overlay — left
          unset it stays the platform default and reads as a foreign band above
          the app's own background. */}
      <StatusBar style="dark" backgroundColor={colors.surface} />
    </SafeAreaProvider>
  );
}

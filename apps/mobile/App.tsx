import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider } from './src/lib/AuthContext';
import { OfflineQueueProvider } from './src/lib/OfflineQueueContext';
import { RootNavigator } from './src/navigation/RootNavigator';

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
      <StatusBar style="dark" />
    </SafeAreaProvider>
  );
}

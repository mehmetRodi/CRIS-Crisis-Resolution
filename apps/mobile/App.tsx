import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ReportScreen } from './src/screens/ReportScreen';

export default function App() {
  return (
    <SafeAreaProvider>
      <ReportScreen />
      <StatusBar style="dark" />
    </SafeAreaProvider>
  );
}

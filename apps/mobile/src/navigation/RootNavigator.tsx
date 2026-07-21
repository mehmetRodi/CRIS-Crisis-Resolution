import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { ReportScreen } from '../screens/ReportScreen';
import { LoginScreen } from '../screens/auth/LoginScreen';
import { SignupScreen } from '../screens/auth/SignupScreen';
import { ConfirmSignupScreen } from '../screens/auth/ConfirmSignupScreen';

export type RootStackParamList = {
  Report: undefined;
  Login: undefined;
  Signup: undefined;
  ConfirmSignup: { email: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * Root navigator (CRIS-7). `Report` is the initial/home route — sign-in is
 * reachable but never required, mirroring the web SPA (ADR-0024): citizens
 * submit anonymously by default; Login/Signup/ConfirmSignup are opt-in.
 * Screens render their own header (back links, titles), so the native header
 * bar is disabled here.
 */
export function RootNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Report" screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Report" component={ReportScreen} />
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Signup" component={SignupScreen} />
        <Stack.Screen name="ConfirmSignup" component={ConfirmSignupScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

import { DefaultTheme, NavigationContainer, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { ReportScreen } from '../screens/ReportScreen';
import { LoginScreen } from '../screens/auth/LoginScreen';
import { SignupScreen } from '../screens/auth/SignupScreen';
import { ConfirmSignupScreen } from '../screens/auth/ConfirmSignupScreen';
import { colors } from '../theme';

export type RootStackParamList = {
  Report: undefined;
  Login: undefined;
  Signup: undefined;
  ConfirmSignup: { email: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * Navigation theme (CRIS-57).
 *
 * React Navigation paints the container and the gap BETWEEN screens with its
 * own theme, not with any screen's styles. Left on the default it fills that
 * gap with pure white, so every push flashes a colour that appears nowhere in
 * the product — most visible on the slow transition into the report screen.
 */
const navigationTheme: Theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.bg,
    card: colors.surface,
    text: colors.fg,
    border: colors.border,
    primary: colors.accent,
    notification: colors.danger,
  },
};

/**
 * Root navigator (CRIS-7). `Report` is the initial route — sign-in is reachable
 * but never required, mirroring the web app (ADR-0024): citizens submit
 * anonymously by default, and Login/Signup/ConfirmSignup are opt-in.
 *
 * Screens render their own header (`ScreenHeader`), so the native header bar is
 * disabled — one header implementation across both clients rather than a native
 * bar here and a custom one on web.
 */
export function RootNavigator() {
  return (
    <NavigationContainer theme={navigationTheme}>
      <Stack.Navigator
        initialRouteName="Report"
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="Report" component={ReportScreen} />
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Signup" component={SignupScreen} />
        <Stack.Screen name="ConfirmSignup" component={ConfirmSignupScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

import { registerRootComponent } from 'expo';

// Configure Amplify (module side effect) before anything renders.
import './src/lib/amplify';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

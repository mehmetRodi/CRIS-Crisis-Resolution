import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App';

/**
 * Web routes. The web SPA is the coordinator/responder/volunteer surface;
 * citizen submission lives in the React Native app (`apps/mobile`, CRIS-6 —
 * see ADR 0020). Dashboard and map routes are added by CRIS-12/CRIS-13.
 */
export function Router() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
      </Routes>
    </BrowserRouter>
  );
}

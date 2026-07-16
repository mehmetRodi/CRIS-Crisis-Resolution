import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './AuthContext';
import App from './App';
import { ReportPage } from './screens/ReportPage';
import LoginPage from './LoginPage';
import SignupPage from './SignupPage';
import ConfirmSignupPage from './ConfirmSignupPage';

/**
 * Web routes. The web SPA is chiefly the coordinator/responder/volunteer
 * surface, but `/report` is a citizen emergency-fallback form so anyone with a
 * browser can file a report without installing the mobile app (ADR-0021;
 * mobile remains the primary citizen channel per ADR-0020). Dashboard and map
 * routes are added by CRIS-12/CRIS-13.
 */
export function Router() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/confirm-signup" element={<ConfirmSignupPage />} />

          <Route path="/report" element={<ReportPage />}/>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
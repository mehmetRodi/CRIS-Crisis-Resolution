import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './AuthContext';
import { ProtectedRoute } from './ProtectedRoute';
import App from './App';
import CitizenReportPage from './CitizenReportPage';
import LoginPage from './LoginPage';
import SignupPage from './SignupPage';
import ConfirmSignupPage from './ConfirmSignupPage';

export function Router() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public routes */}
          <Route path="/" element={<App />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/confirm-signup" element={<ConfirmSignupPage />} />

          {/* Protected routes */}
          <Route
            path="/citizen"
            element={
              // <ProtectedRoute>
                <CitizenReportPage />
              // </ProtectedRoute>
            }
            
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
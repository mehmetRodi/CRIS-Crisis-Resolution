import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './AuthContext';
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
          <Route path="/" element={<App />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/confirm-signup" element={<ConfirmSignupPage />} />

          <Route path="/citizen" element={<CitizenReportPage />}/>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
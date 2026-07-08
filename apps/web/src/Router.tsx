import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App';
import CitizenReportPage from './CitizenReportPage';

export function Router() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/citizen" element={<CitizenReportPage />} />
      </Routes>
    </BrowserRouter>
  );
}
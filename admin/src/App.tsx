import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './lib/auth';
import Login from './routes/Login';
import ProtectedRoute from './routes/ProtectedRoute';
import DashboardLayout from './routes/DashboardLayout';
import KycQueue from './routes/KycQueue';
import ComplaintsQueue from './routes/ComplaintsQueue';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <DashboardLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/kyc" replace />} />
            <Route path="kyc" element={<KycQueue />} />
            <Route path="complaints" element={<ComplaintsQueue />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

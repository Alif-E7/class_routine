import { Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './contexts/AuthContext';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import Homepage from './pages/Homepage';
import PublicRoutineViewPage from './pages/PublicRoutineViewPage';
import LoginPage from './pages/LoginPage';
import UploadPage from './pages/UploadPage';
import HistoryPage from './pages/HistoryPage';
import RoutinePage from './pages/RoutinePage';

import ErrorBoundary from './components/ErrorBoundary';

function App() {
  return (
    <AuthProvider>
      <Toaster position="top-right" />
      <ErrorBoundary>
        <Routes>
          {/* Login page — full-screen, no Layout shell */}
          <Route path="/login" element={<LoginPage />} />

          {/* App routes — share the Layout (TopNav + scrollable main) */}
          <Route element={<Layout />}>
            {/* Public: Homepage (Class Routines viewer) & standalone routine page */}
            <Route index element={<Homepage />} />
            <Route path="/routines" element={<Homepage />} />
            <Route path="/routines/:id" element={<PublicRoutineViewPage />} />

            {/* Protected: only logged-in admins */}
            <Route path="/upload" element={<ProtectedRoute><UploadPage /></ProtectedRoute>} />
            <Route path="/history" element={<ProtectedRoute><HistoryPage /></ProtectedRoute>} />
            <Route path="/batches/:id" element={<ProtectedRoute><RoutinePage /></ProtectedRoute>} />
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ErrorBoundary>
    </AuthProvider>
  );
}

export default App;

import { Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './contexts/AuthContext';
import Layout from './components/Layout';
import UploadPage from './pages/UploadPage';
import HistoryPage from './pages/HistoryPage';
import RoutinePage from './pages/RoutinePage';
import LoginPage from './pages/LoginPage';
import ErrorBoundary from './components/ErrorBoundary';

function App() {
  return (
    <AuthProvider>
      <Toaster position="top-right" />
      <ErrorBoundary>
        <Routes>
          {/* App routes — share the Layout (TopNav + scrollable main) */}
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/history" replace />} />
            <Route path="/upload" element={<UploadPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/batches/:id" element={<RoutinePage />} />
          </Route>

          {/* Admin Login */}
          <Route path="/login" element={<LoginPage />} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/history" replace />} />
        </Routes>
      </ErrorBoundary>
    </AuthProvider>
  );
}

export default App;


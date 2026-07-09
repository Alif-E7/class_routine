import { Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './contexts/AuthContext';
import Layout from './components/Layout';
import UploadPage from './pages/UploadPage';
import HistoryPage from './pages/HistoryPage';
import RoutinePage from './pages/RoutinePage';
import LoginPage from './pages/LoginPage';
import ProtectedRoute from './components/ProtectedRoute';

function App() {
  return (
    <AuthProvider>
      <Toaster position="top-right" />
      <Routes>
        {/* Login page (no layout) */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/admin" element={<Navigate to="/history" replace />} />

        {/* App routes — share the Layout (TopNav + scrollable main) */}
        <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route index element={<Navigate to="/history" replace />} />
          <Route path="/upload" element={<UploadPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/batches/:id" element={<RoutinePage />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/history" replace />} />
      </Routes>
    </AuthProvider>
  );
}

export default App;

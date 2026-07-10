import { Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './contexts/AuthContext';
import Layout from './components/Layout';
import UploadPage from './pages/UploadPage';
import HistoryPage from './pages/HistoryPage';
import RoutinePage from './pages/RoutinePage';

function App() {
  return (
    <AuthProvider>
      <Toaster position="top-right" />
      <Routes>
        {/* App routes — share the Layout (TopNav + scrollable main) */}
        <Route element={<Layout />}>
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

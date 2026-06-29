import axios from 'axios';

const api = axios.create({
  baseURL: '/api'
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const authApi = {
  login: (credentials) => api.post('/auth/login', credentials)
};

export const routineApi = {
  uploadExcel: (formData) => api.post('/upload-routine', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  // Dry-run validation: parses the file, runs the pre-flight linter, returns
  // every rule violation. Does NOT touch the DB.
  lintExcel: (formData) => api.post('/upload-routine/lint', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  getRoutine: (params) => api.get('/routine', { params })
};

export const templateApi = {
  download: () => api.get('/template/download', { responseType: 'blob' })
};

export const masterApi = {
  getDepartments: (params) => api.get('/departments', { params }),
  getSections: (params) => api.get('/departments/sections', { params }),
  getSemesters: () => api.get('/semesters'),
  exportDepartmentRoutine: (semesterId, deptCode) => api.get(`/semesters/${semesterId}/departments/${deptCode}/export`, { responseType: 'blob' }),
  getDepartmentRoutineData: (semesterId, deptCode) => api.get(`/semesters/${semesterId}/departments/${deptCode}/data`),
  updateDepartmentRoutineData: (semesterId, deptCode, data) => api.put(`/semesters/${semesterId}/departments/${deptCode}/data`, data)
};

export default api;

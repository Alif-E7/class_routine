import axios from 'axios';

// All calls go to /api/* which Vite proxies to the backend on :4000
// (see client/vite.config.js).
const api = axios.create({
  baseURL: '/api',
  // The backend occasionally takes a few seconds on /generate;
  // give it room without making the UI feel hung.
  timeout: 60_000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    // Normalize backend error envelope so pages can read err.code / err.message
    const data = err.response?.data;
    if (data && typeof data === 'object') {
      err.code = data.code || null;
      err.message = data.message || err.message;
      err.details = data.details || null;
      err.errors = data.errors || null;
      err.warnings = data.warnings || null;
      err.unplaceable = data.unplaceable || null;
      err.friendly_hint = data.friendly_hint || null;
      err.batch_id = data.batch_id || null;
      err.is_valid = data.is_valid ?? null;
    }
    return Promise.reject(err);
  }
);

export const authApi = {
  login: (credentials) => api.post('/auth/login', credentials),
};

export const routineApi = {
  /**
   * Upload a workbook.
   * @param {FormData} formData — must include "file" (.xlsx) and optionally "semester".
   */
  uploadExcel: (formData) =>
    api.post('/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),

  /**
   * Run the CSP solver against a stored batch.
   * @param {number} batchId
   * @param {{ seed?: number }} [opts]
   */
  generateRoutine: (batchId, opts = {}) =>
    api.post(`/batches/${batchId}/generate`, opts),

  /**
   * Fetch the persisted schedule for a batch.
   * @param {number} batchId
   */
  getRoutine: (batchId) => api.get(`/batches/${batchId}/schedule`),
};

export const batchesApi = {
  list: () => api.get('/batches'),
  detail: (batchId) => api.get(`/batches/${batchId}`),
};

/**
 * editApi — ask the AI assistant to draft a manual edit to an
 * already-generated schedule. The backend (POST /api/batches/:id/edit)
 * returns ADVISORY PROPOSALS only; applying the change requires a
 * separate admin endpoint that is not part of Step 8.
 *
 * Response shapes the UI cares about:
 *   200 → { success: true, code: 'EDIT_PROPOSED', prompt, proposal }
 *   400 → INVALID_BATCH_ID | INVALID_PROMPT
 *   404 → BATCH_NOT_FOUND
 *   409 → BATCH_NOT_READY
 *   502 → AI_INVALID_RESPONSE   (AI ran but produced unusable output)
 *   503 → AI_UNAVAILABLE        (no GEMINI_API_KEY on server, or transport error)
 *
 * The axios response interceptor normalizes err.code / err.message /
 * err.reason so the page can route on those without re-parsing.
 */
export const editApi = {
  /**
   * @param {number} batchId
   * @param {string} prompt  free-text request, e.g. "move CSE406 from SUN 9am to MON 10am"
   * @returns {Promise<{proposal: {kind, summary, change, question, concerns}}>}
   */
  askEdit(batchId, prompt) {
    return api.post(`/batches/${batchId}/edit`, { prompt }).then((res) => ({
      proposal: res.data.proposal,
      batchId: res.data.batch_id,
      prompt: res.data.prompt,
      raw: res.data,
    }));
  },
};

/**
 * Export endpoints — DOCX + PDF.
 *
 * The backend streams a binary attachment; the easiest way to deliver
 * a "save as" experience in the browser is to fetch the file as a
 * Blob and synthesize an `<a download>` click. We do NOT use
 * `window.open()` because (a) backend errors come back as JSON and
 * would render as a wall of text, and (b) auth headers don't carry.
 *
 * On a 4xx/5xx the function rejects with an Error whose `.code` /
 * `.message` reflect the backend envelope so the page can show a
 * meaningful toast.
 */
export const exportApi = {
  /**
   * Fetch a batch's routine as .docx and trigger a browser download.
   * @param {number} batchId
   * @returns {Promise<{filename: string, size: number}>}
   */
  async downloadDocx(batchId) {
    const res = await api.get(`/batches/${batchId}/export.docx`, {
      responseType: 'blob',
    });
    const filename = parseFilename(res.headers['content-disposition'])
      || `routine_batch${batchId}.docx`;
    saveBlob(res.data, filename);
    return { filename, size: res.data.size };
  },

  /**
   * Fetch a batch's routine as .pdf and trigger a browser download.
   * Backend may return 501 PDF_UNAVAILABLE if LibreOffice isn't
   * installed on the server.
   * @param {number} batchId
   * @returns {Promise<{filename: string, size: number}>}
   */
  async downloadPdf(batchId) {
    const res = await api.get(`/batches/${batchId}/export.pdf`, {
      responseType: 'blob',
    });
    const filename = parseFilename(res.headers['content-disposition'])
      || `routine_batch${batchId}.pdf`;
    saveBlob(res.data, filename);
    return { filename, size: res.data.size };
  },
};

function parseFilename(contentDisposition) {
  if (!contentDisposition) return null;
  const m = /filename="([^"]+)"/i.exec(contentDisposition);
  return m ? m[1] : null;
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke after a tick so the browser has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default api;

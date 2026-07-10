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
  getTeachers: (batchId) => api.get(`/batches/${batchId}/teachers`),
  getWorkbook: (batchId) => api.get(`/batches/${batchId}/workbook`),
  updateWorkbook: (batchId, workbook) => api.post(`/batches/${batchId}/workbook`, { workbook }),
  /**
   * Hard-delete a batch. Cascades to teachers/courses/rooms/credit_rules/
   * room_preference/teacher_unavailability/config/schedules.
   *
   *   200 → { success, batch_id, deleted: { teachers, courses, … } }
   *   400 → INVALID_BATCH_ID
   *   404 → BATCH_NOT_FOUND
   *
   * @param {number} batchId
   * @returns {Promise<{batch_id:number, deleted:object}>}
   */
  delete: (batchId) =>
    api.delete(`/batches/${batchId}`).then((res) => res.data),
};

/**
 * explainApi — ask the AI assistant for a short plain-text explanation
 * of how to fix a single validator error/warning. The backend
 * (POST /api/batches/:id/explain-error) forwards the validator's own
 * rule/sheet/row/column/message to Gemini and returns a 2-3 sentence
 * remediation paragraph. This powers the per-row "How do I fix this?"
 * button in the validation panel.
 *
 * Response shapes the UI cares about:
 *   200 → { success, code: 'EXPLANATION_PROVIDED', explanation, … }
 *   400 → INVALID_BATCH_ID | INVALID_ISSUE
 *   404 → BATCH_NOT_FOUND
 *   502 → AI_INVALID_RESPONSE   (AI ran but produced no usable text)
 *   503 → AI_UNAVAILABLE        (no GEMINI_API_KEY on server, or transport error)
 *
 * The axios response interceptor normalizes err.code / err.message /
 * err.reason so the page can route on those without re-parsing.
 */
export const explainApi = {
  /**
   * @param {number} batchId
   * @param {{rule?:string, code?:string, severity:'error'|'warning',
   *          message:string, sheet?:string, row?:number|string,
   *          column?:string, value?:any}} issue
   * @returns {Promise<{explanation:string, rule, severity, sheet, row, column, batch_id, raw}>}
   */
  explainValidatorError(batchId, issue) {
    return api
      .post(`/batches/${batchId}/explain-error`, { issue })
      .then((res) => ({
        explanation: res.data.explanation,
        rule: res.data.rule,
        severity: res.data.severity,
        sheet: res.data.sheet,
        row: res.data.row,
        column: res.data.column,
        batch_id: res.data.batch_id,
        raw: res.data,
      }));
  },
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
   * @param {number} [score] optional routine score out of 10
   * @param {Array}  [history] optional array of previous messages for chat context
   */
  askEdit(batchId, prompt, score = null, history = []) {
    return api.post(`/batches/${batchId}/edit`, { prompt, score, history }).then((res) => ({
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

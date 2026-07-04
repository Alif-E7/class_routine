import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  UploadCloud,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Loader2,
  FileSpreadsheet,
  ArrowRight,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { routineApi } from '../api/client';

const formatViolation = (v) => {
  const loc =
    (v.sheet || '') +
    (v.row ? ` · row ${v.row}` : '') +
    (v.column ? ` · ${v.column}` : '');
  return `[${v.rule}] ${loc} — ${v.message}`;
};

const UploadPage = () => {
  const navigate = useNavigate();
  const [file, setFile] = useState(null);
  const [semester, setSemester] = useState('');
  const [uploading, setUploading] = useState(false);
  const [success, setSuccess] = useState(null); // { batch_id, counts, warnings }
  const [validation, setValidation] = useState(null); // { errors, warnings }

  const handleDragOver = (e) => {
    e.preventDefault();
  };
  const handleDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
      setSuccess(null);
      setValidation(null);
    }
  };
  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setSuccess(null);
      setValidation(null);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) {
      toast.error('Please choose an .xlsx file first.');
      return;
    }
    if (!/\.xlsx$/i.test(file.name)) {
      toast.error('Only .xlsx files are accepted.');
      return;
    }
    setUploading(true);
    setSuccess(null);
    setValidation(null);
    const tid = toast.loading('Parsing and validating workbook…');
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (semester.trim()) fd.append('semester', semester.trim());

      const res = await routineApi.uploadExcel(fd);
      const data = res.data;
      toast.success(
        `Imported successfully — batch #${data.data.batch_id}.`,
        { id: tid }
      );
      setSuccess({
        batch_id: data.data.batch_id,
        counts: data.data,
        warnings: data.warnings || [],
      });
      setFile(null);
    } catch (err) {
      // 422 validation failure
      if (err.code === 'VALIDATION_FAILED') {
        toast.error(
          `Validation found ${err.errors?.length || 0} error(s).`,
          { id: tid, duration: 6000 }
        );
        setValidation({
          errors: err.errors || [],
          warnings: err.warnings || [],
          batch_id: err.batch_id,
        });
      } else if (err.code === 'PARSE_ERROR') {
        toast.error(err.message || 'Could not parse workbook.', { id: tid });
      } else {
        toast.error(err.message || 'Upload failed.', { id: tid });
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="bg-linear-to-br from-ocean-900 to-ocean-800 rounded-2xl px-6 py-5 text-white border border-sky-500/15 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="bg-sky-400/20 p-2.5 rounded-xl border border-sky-400/20">
            <FileSpreadsheet className="w-5 h-5 text-sky-400" />
          </div>
          <div>
            <p className="text-xs font-semibold tracking-widest uppercase text-sky-400 mb-0.5">
              Step 1 of 3
            </p>
            <h1 className="text-2xl font-bold">Upload Routine Workbook</h1>
            <p className="text-sky-300 text-sm">
              Upload the formatted .xlsx — teachers, courses, rooms, rules.
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Semester label (optional)
            </label>
            <input
              type="text"
              placeholder="e.g. 2026 July-December"
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none transition-shadow"
              value={semester}
              onChange={(e) => setSemester(e.target.value)}
            />
          </div>

          <div
            className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors cursor-pointer ${
              file
                ? 'border-sky-500 bg-sky-50'
                : 'border-ocean-200 hover:border-sky-400 hover:bg-ocean-50'
            }`}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onClick={() => document.getElementById('file-upload').click()}
          >
            <input
              id="file-upload"
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleFileChange}
            />
            {file ? (
              <div className="flex flex-col items-center gap-2">
                <CheckCircle2 className="w-12 h-12 text-green-500" />
                <p className="font-semibold text-slate-700 text-lg">{file.name}</p>
                <p className="text-sm text-slate-500">
                  {(file.size / 1024 / 1024).toFixed(2)} MB · click to change
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <div className="p-3 bg-sky-100 rounded-full text-sky-600 mb-2">
                  <UploadCloud className="w-10 h-10" />
                </div>
                <p className="font-medium text-slate-700 text-lg">
                  Click or drag Excel file to upload
                </p>
                <p className="text-sm text-slate-500">
                  .xlsx only · max 10 MB · 7 sheets (Teachers, Courses, Rooms, …)
                </p>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={uploading || !file}
            className="w-full py-3 bg-ocean-700 hover:bg-ocean-800 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Uploading…
              </>
            ) : (
              <>
                <UploadCloud className="w-5 h-5" />
                Upload &amp; Validate
              </>
            )}
          </button>
        </form>
      </div>

      {/* Success summary */}
      {success && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle2 className="w-6 h-6 text-emerald-600" />
            <h2 className="font-semibold text-emerald-900">Upload successful</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            {[
              { label: 'Teachers', value: success.counts.teachers },
              { label: 'Courses', value: success.counts.courses },
              { label: 'Rooms', value: success.counts.rooms },
              {
                label: 'Configs',
                value: success.counts.config_keys,
              },
            ].map(({ label, value }) => (
              <div
                key={label}
                className="bg-white rounded-xl border border-emerald-100 shadow-sm px-3 py-2.5"
              >
                <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">
                  {label}
                </p>
                <p className="font-bold text-xl text-emerald-700">{value ?? 0}</p>
              </div>
            ))}
          </div>
          {success.warnings.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-sm text-amber-800">
              <AlertTriangle className="w-4 h-4 inline mr-2" />
              {success.warnings.length} warning(s) — proceed with caution.
            </div>
          )}
          <button
            onClick={() => navigate(`/batches/${success.batch_id}`)}
            className="inline-flex items-center gap-2 bg-ocean-700 hover:bg-ocean-800 text-white px-4 py-2 rounded-lg font-medium transition-colors"
          >
            View batch #{success.batch_id} <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Validation errors */}
      {validation && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className="w-6 h-6 text-red-600" />
            <h2 className="font-semibold text-red-900">
              {validation.errors.length} validation error(s) found
            </h2>
          </div>
          <p className="text-sm text-red-700 mb-4">
            Fix the issues below and re-upload. Nothing was persisted to the
            database (batch #{validation.batch_id} is in <em>needs_review</em>).
          </p>
          <ul className="space-y-1.5 text-sm">
            {validation.errors.slice(0, 30).map((e, i) => (
              <li key={i} className="flex gap-2">
                <span className="font-mono text-[11px] bg-red-100 text-red-800 px-1.5 py-0.5 rounded shrink-0">
                  {e.rule}
                </span>
                <span className="text-red-700">
                  <span className="text-red-500 text-xs">
                    {e.sheet}
                    {e.row ? ` row ${e.row}` : ''}
                    {e.column ? ` · ${e.column}` : ''}
                  </span>
                  <span className="block">{e.message}</span>
                </span>
              </li>
            ))}
            {validation.errors.length > 30 && (
              <li className="text-red-600 italic text-xs">
                …and {validation.errors.length - 30} more.
              </li>
            )}
          </ul>
          <button
            onClick={() => navigate(`/batches/${validation.batch_id}`)}
            className="mt-4 text-sm text-ocean-700 hover:text-ocean-900 underline"
          >
            View error log on batch #{validation.batch_id}
          </button>
        </div>
      )}
    </div>
  );
};

export default UploadPage;
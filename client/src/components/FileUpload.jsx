import { useState } from 'react';
import { UploadCloud, CheckCircle2, AlertCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { routineApi } from '../api/client';
import toast from 'react-hot-toast';

// Format a single linter violation as a one-line, high-signal toast message.
const formatViolation = (v) => {
  const loc = v.sheet + (v.row ? ` · row ${v.row}` : '') + (v.column ? ` · ${v.column}` : '');
  return `[${v.rule}] ${loc} — ${v.message}`;
};

const FileUpload = ({ onUploadSuccess }) => {
  const [file, setFile] = useState(null);
  const [semesterName, setSemesterName] = useState('');
  const [departmentCode, setDepartmentCode] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isLinting, setIsLinting] = useState(false);

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  // Run the pre-flight linter (dry run, no DB writes).
  // Returns true if file is safe to upload, false otherwise.
  const runLint = async () => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('semesterName', semesterName);
    fd.append('departmentCode', departmentCode.toUpperCase());

    const res = await routineApi.lintExcel(fd);
    const { errors = [], warnings = [] } = res.data || {};

    if (errors.length > 0) {
      toast.error(
        `Pre-flight check found ${errors.length} error${errors.length === 1 ? '' : 's'}. Fix and retry.`,
        { duration: 6000 }
      );
      errors.slice(0, 6).forEach((v) => toast.error(formatViolation(v), { duration: 8000 }));
      if (errors.length > 6) {
        toast.error(`…and ${errors.length - 6} more. See console for full list.`, { duration: 8000 });
      }
      // Full report in console for copy/paste
      // eslint-disable-next-line no-console
      console.groupCollapsed(`Lint report — ${errors.length} errors, ${warnings.length} warnings`);
      // eslint-disable-next-line no-console
      console.table([...errors, ...warnings]);
      // eslint-disable-next-line no-console
      console.groupEnd();
      return false;
    }

    if (warnings.length > 0) {
      toast(
        `Lint passed with ${warnings.length} warning${warnings.length === 1 ? '' : 's'}. Proceeding with upload.`,
        { icon: '⚠️', duration: 5000 }
      );
      warnings.slice(0, 3).forEach((v) => toast(formatViolation(v), { icon: '⚠️', duration: 6000 }));
      // eslint-disable-next-line no-console
      console.groupCollapsed(`Lint warnings — ${warnings.length}`);
      // eslint-disable-next-line no-console
      console.table(warnings);
      // eslint-disable-next-line no-console
      console.groupEnd();
    } else {
      toast.success('Pre-flight check passed. Importing…', { duration: 2500 });
    }
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file || !semesterName || !departmentCode) {
      toast.error('Please provide a file, semester name, and department code');
      return;
    }

    setIsLinting(true);
    try {
      const ok = await runLint();
      if (!ok) return; // errors surfaced, abort upload
    } catch (lintErr) {
      const msg = lintErr.response?.data?.message || 'Pre-flight check failed';
      toast.error(msg);
      if (lintErr.response?.data?.details) {
        // eslint-disable-next-line no-console
        console.error('Lint failed:', lintErr.response.data);
      }
      return;
    } finally {
      setIsLinting(false);
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('semesterName', semesterName);
      formData.append('departmentCode', departmentCode.toUpperCase());

      const res = await routineApi.uploadExcel(formData);
      toast.success(res.data.message || 'Routine imported successfully!');
      setFile(null);
      setSemesterName('');
      setDepartmentCode('');
      if (onUploadSuccess) onUploadSuccess(res.data.data);
    } catch (error) {
      const msg = error.response?.data?.message || 'Error uploading file';
      const details = error.response?.data?.details;
      toast.error(msg);
      if (details && Array.isArray(details)) {
        details.forEach(d => toast.error(d, { duration: 5000 }));
      }
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
      <h3 className="text-lg font-semibold text-slate-800 mb-4">Upload New Routine</h3>
      
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Semester Name</label>
            <input
              type="text"
              required
              placeholder="e.g. January-July 2025"
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none transition-shadow"
              value={semesterName}
              onChange={(e) => setSemesterName(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Department Code</label>
            <input
              type="text"
              required
              placeholder="e.g. CSE"
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none transition-shadow uppercase"
              value={departmentCode}
              onChange={(e) => setDepartmentCode(e.target.value.toUpperCase())}
            />
          </div>
        </div>

        <div 
          className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${
            file ? 'border-sky-500 bg-sky-50' : 'border-ocean-200 hover:border-sky-400 hover:bg-ocean-50'
          }`}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={() => document.getElementById('file-upload').click()}
        >
          <input
            id="file-upload"
            type="file"
            accept=".xlsx, .xls"
            className="hidden"
            onChange={handleFileChange}
          />
          
          {file ? (
            <div className="flex flex-col items-center gap-2">
              <CheckCircle2 className="w-10 h-10 text-green-500" />
              <p className="font-medium text-slate-700">{file.name}</p>
              <p className="text-sm text-slate-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <div className="p-3 bg-sky-100 rounded-full text-sky-600 mb-2">
                <UploadCloud className="w-8 h-8" />
              </div>
              <p className="font-medium text-slate-700">Click or drag Excel file to upload</p>
              <p className="text-sm text-slate-500">Must follow the standard template format</p>
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={isLinting || isUploading || !file || !semesterName || !departmentCode}
          className="w-full py-3 bg-ocean-700 hover:bg-ocean-800 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLinting ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Checking file…
            </>
          ) : isUploading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Importing…
            </>
          ) : (
            'Import Routine'
          )}
        </button>
      </form>
    </div>
  );
};

export default FileUpload;

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Calendar,
  Upload,
  Loader2,
  FileSpreadsheet,
  AlertCircle,
  CheckCircle2,
  ChevronRight,
} from 'lucide-react';
import { batchesApi } from '../api/client';

const STATUS_STYLES = {
  completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  processing: 'bg-amber-50 text-amber-700 border-amber-200',
  failed: 'bg-red-50 text-red-700 border-red-200',
  needs_review: 'bg-orange-50 text-orange-700 border-orange-200',
};

const STATUS_ICON = {
  completed: CheckCircle2,
  processing: Loader2,
  failed: AlertCircle,
  needs_review: AlertCircle,
};

const HistoryPage = () => {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await batchesApi.list();
      setBatches(res.data.batches || []);
    } catch (err) {
      setError(err.message || 'Failed to load batches.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="bg-linear-to-br from-ocean-900 to-ocean-800 rounded-2xl px-6 py-5 text-white border border-sky-500/15 shadow-lg flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-sky-400/20 p-2.5 rounded-xl border border-sky-400/20">
            <Calendar className="w-5 h-5 text-sky-400" />
          </div>
          <div>
            <p className="text-xs font-semibold tracking-widest uppercase text-sky-400 mb-0.5">
              Step 3
            </p>
            <h1 className="text-2xl font-bold">History</h1>
            <p className="text-sky-300 text-sm">
              All uploaded workbooks. Open one to view or generate its routine.
            </p>
          </div>
        </div>
        <Link
          to="/upload"
          className="bg-sky-500 hover:bg-sky-400 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2"
        >
          <Upload className="w-4 h-4" />
          New upload
        </Link>
      </div>

      {loading && (
        <div className="flex items-center justify-center h-40 text-ocean-600">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-red-800">
          <AlertCircle className="w-6 h-6 mb-2" />
          {error}
          <button
            onClick={load}
            className="ml-3 underline text-red-700 hover:text-red-900"
          >
            retry
          </button>
        </div>
      )}

      {!loading && !error && batches.length === 0 && (
        <div className="bg-white border border-dashed border-ocean-200 rounded-2xl p-12 text-center">
          <FileSpreadsheet className="w-12 h-12 text-ocean-300 mx-auto mb-3" />
          <p className="text-slate-600 font-medium">No uploads yet</p>
          <p className="text-slate-400 text-sm mb-5">
            Upload your first workbook to get started.
          </p>
          <Link
            to="/upload"
            className="inline-flex items-center gap-2 bg-ocean-700 hover:bg-ocean-800 text-white px-4 py-2 rounded-lg font-medium"
          >
            <Upload className="w-4 h-4" /> Upload workbook
          </Link>
        </div>
      )}

      {!loading && !error && batches.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="text-left px-5 py-3 font-semibold w-16">#</th>
                <th className="text-left px-5 py-3 font-semibold">Filename</th>
                <th className="text-left px-5 py-3 font-semibold">Semester</th>
                <th className="text-left px-5 py-3 font-semibold">Status</th>
                <th className="text-right px-5 py-3 font-semibold w-32">Teachers</th>
                <th className="text-right px-5 py-3 font-semibold w-32">Courses</th>
                <th className="text-right px-5 py-3 font-semibold w-32">Rooms</th>
                <th className="text-right px-5 py-3 font-semibold w-32">Classes</th>
                <th className="text-left px-5 py-3 font-semibold">Imported</th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {batches.map((b) => {
                const StatusIcon = STATUS_ICON[b.status] || CheckCircle2;
                return (
                  <tr
                    key={b.id}
                    className="hover:bg-sky-50 transition-colors cursor-pointer"
                    onClick={() => (window.location.href = `/batches/${b.id}`)}
                  >
                    <td className="px-5 py-3 text-slate-500 font-mono">#{b.id}</td>
                    <td className="px-5 py-3 font-semibold text-slate-800 truncate max-w-xs">
                      {b.filename}
                    </td>
                    <td className="px-5 py-3 text-slate-600">{b.semester || '—'}</td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs font-semibold border px-2 py-0.5 rounded-full ${
                          STATUS_STYLES[b.status] || 'bg-slate-50 text-slate-700 border-slate-200'
                        }`}
                      >
                        <StatusIcon
                          className={`w-3.5 h-3.5 ${
                            b.status === 'processing' ? 'animate-spin' : ''
                          }`}
                        />
                        {String(b.status || 'unknown').replace(/_/g, ' ')}
                      </span>
                      {b.has_schedule && (
                        <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-semibold bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded-full border border-sky-200">
                          scheduled
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-slate-700">
                      {b.counts.teachers}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-slate-700">
                      {b.counts.courses}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-slate-700">
                      {b.counts.rooms}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-ocean-700 font-semibold">
                      {b.counts.assignments}
                    </td>
                    <td className="px-5 py-3 text-slate-500 text-xs">
                      {b.created_at
                        ? new Date(b.created_at).toLocaleString()
                        : '—'}
                    </td>
                    <td className="px-5 py-3 text-slate-400">
                      <ChevronRight className="w-4 h-4" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default HistoryPage;
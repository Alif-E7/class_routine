import { useCallback, useEffect, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Calendar,
  Upload,
  Loader2,
  FileSpreadsheet,
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Trash2,
  X,
  Building2,
  GraduationCap,
} from 'lucide-react';
import toast from 'react-hot-toast';
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
  const navigate = useNavigate();
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [selectedFaculty, setSelectedFaculty] = useState('All');
  const [selectedDepartment, setSelectedDepartment] = useState('All');

  useEffect(() => {
    if (!showArchived) {
      setSelectedFaculty('All');
      setSelectedDepartment('All');
    }
  }, [showArchived]);

  const archivedCount = useMemo(() => {
    const fifteenDaysAgo = new Date();
    fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);
    return batches.filter((b) => {
      if (!b.created_at) return false;
      return new Date(b.created_at) < fifteenDaysAgo;
    }).length;
  }, [batches]);

  const facultiesWithCounts = useMemo(() => {
    const map = new Map();
    for (const b of batches) {
      if (!b.faculty) continue;
      const fac = b.faculty.trim();
      map.set(fac, (map.get(fac) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [batches]);

  const departmentsWithCounts = useMemo(() => {
    const map = new Map();
    for (const b of batches) {
      if (selectedFaculty !== 'All' && b.faculty) {
        if (b.faculty.trim().toLowerCase() !== selectedFaculty.trim().toLowerCase()) {
          continue;
        }
      }
      const dept = (b.department || 'CSE').trim();
      map.set(dept, (map.get(dept) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [batches, selectedFaculty]);

  const displayedBatches = useMemo(() => {
    let list = batches;
    if (!showArchived) {
      const fifteenDaysAgo = new Date();
      fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);
      list = list.filter((b) => {
        if (!b.created_at) return true;
        return new Date(b.created_at) >= fifteenDaysAgo;
      });
    }

    if (showArchived) {
      if (selectedFaculty !== 'All') {
        list = list.filter((b) => {
          return b.faculty && b.faculty.trim().toLowerCase() === selectedFaculty.trim().toLowerCase();
        });
      }
      if (selectedDepartment !== 'All') {
        list = list.filter((b) => {
          const dept = (b.department || 'CSE').trim();
          return dept.toLowerCase() === selectedDepartment.toLowerCase();
        });
      }
    }

    return list;
  }, [batches, showArchived, selectedFaculty, selectedDepartment]);

  // Delete confirmation modal state.
  const [deleteTarget, setDeleteTarget] = useState(null); // {id, filename} | null
  const [deleting, setDeleting] = useState(false);

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

  // Open the confirm modal; never let the click bubble to the row's
  // onClick (which navigates to the routine page).
  const handleAskDelete = (e, batch) => {
    e.stopPropagation();
    e.preventDefault();
    if (batchingHasSideEffects(batch)) {
      setDeleteTarget(batch);
    } else {
      setDeleteTarget(batch);
    }
  };

  const batchingHasSideEffects = (_b) => true; // keep modal for every delete — safer

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const tid = toast.loading(`Deleting "${deleteTarget.filename}"…`);
    try {
      const res = await batchesApi.delete(deleteTarget.id);
      const removed = res?.deleted || {};
      const total = Object.values(removed).reduce((s, n) => s + (Number(n) || 0), 0);
      const extra = total > 0 ? ` (${total} related row${total === 1 ? '' : 's'} cleared)` : '';
      toast.success(`Deleted "${deleteTarget.filename}"${extra}.`, { id: tid });
      setDeleteTarget(null);
      await load();
    } catch (err) {
      const code = err.code;
      let msg = err.message || 'Failed to delete batch.';
      if (code === 'BATCH_NOT_FOUND') {
        msg = 'This batch was already deleted.';
        setDeleteTarget(null);
        await load();
      } else if (code === 'INVALID_BATCH_ID') {
        msg = 'Invalid batch id in URL.';
      }
      toast.error(msg, { id: tid, duration: 6000 });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="bg-gradient-to-br from-ocean-900 to-ocean-800 rounded-2xl px-6 py-5 text-white border border-sky-500/15 shadow-lg flex items-center justify-between">
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
        <div className="space-y-4">
          <div className="flex justify-between items-center bg-slate-50 border border-slate-200 px-4 py-3 rounded-xl shadow-xs">
            <span className="text-xs text-slate-500 font-semibold">
              {showArchived
                ? selectedDepartment !== 'All'
                  ? `Showing archived routines for ${selectedDepartment} (${displayedBatches.length} routines)`
                  : `Showing all archived uploads (${displayedBatches.length} total)`
                : archivedCount > 0
                  ? `Showing recent uploads (${archivedCount} archived items hidden)`
                  : `Showing recent uploads (${batches.length} total)`}
            </span>
            <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
              />
              Show Archived (১৫ দিনের বেশি পুরোনো)
            </label>
          </div>

          {/* 2-Tier Faculty & Department Filter Pills (shown when Show Archived is active) */}
          {showArchived && (
            <div className="bg-white border border-slate-200 p-4 sm:p-5 rounded-2xl shadow-xs space-y-4">
              {/* 1. Faculty Filter Section */}
              {facultiesWithCounts.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="bg-purple-50 p-1.5 rounded-lg border border-purple-100">
                        <GraduationCap className="w-4 h-4 text-purple-600" />
                      </div>
                      <div>
                        <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                          Filter by Faculty (অনুষদ অনুযায়ী রুটিন)
                        </h3>
                        <p className="text-[11px] text-slate-400">
                          Select a faculty to narrow down department routines.
                        </p>
                      </div>
                    </div>
                    {selectedFaculty !== 'All' && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedFaculty('All');
                          setSelectedDepartment('All');
                        }}
                        className="text-xs font-semibold text-purple-600 hover:text-purple-800 hover:underline cursor-pointer"
                      >
                        All Faculties
                      </button>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedFaculty('All');
                        setSelectedDepartment('All');
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                        selectedFaculty === 'All'
                          ? 'bg-purple-600 text-white shadow-xs ring-2 ring-purple-600/20'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200/80'
                      }`}
                    >
                      <span>All Faculties</span>
                      <span
                        className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                          selectedFaculty === 'All'
                            ? 'bg-purple-700 text-purple-100'
                            : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {batches.length}
                      </span>
                    </button>

                    {facultiesWithCounts.map((fac) => {
                      const isSelected = selectedFaculty.toLowerCase() === fac.name.toLowerCase();
                      return (
                        <button
                          key={fac.name}
                          type="button"
                          onClick={() => {
                            setSelectedFaculty(fac.name);
                            setSelectedDepartment('All');
                          }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                            isSelected
                              ? 'bg-purple-600 text-white shadow-xs ring-2 ring-purple-600/20'
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200/80'
                          }`}
                        >
                          <GraduationCap
                            className={`w-3.5 h-3.5 ${
                              isSelected ? 'text-purple-100' : 'text-slate-500'
                            }`}
                          />
                          <span>{fac.name}</span>
                          <span
                            className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                              isSelected
                                ? 'bg-purple-700 text-purple-100'
                                : 'bg-slate-200 text-slate-600'
                            }`}
                          >
                            {fac.count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 2. Department Filter Section */}
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="bg-sky-50 p-1.5 rounded-lg border border-sky-100">
                      <Building2 className="w-4 h-4 text-sky-600" />
                    </div>
                    <div>
                      <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                        Filter by Department (বিভাগ অনুযায়ী রুটিন)
                      </h3>
                      <p className="text-[11px] text-slate-400">
                        Click any department to view all uploaded and generated class routines under it.
                      </p>
                    </div>
                  </div>
                  {selectedDepartment !== 'All' && (
                    <button
                      type="button"
                      onClick={() => setSelectedDepartment('All')}
                      className="text-xs font-semibold text-sky-600 hover:text-sky-800 hover:underline cursor-pointer"
                    >
                      View All Departments
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setSelectedDepartment('All')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                      selectedDepartment === 'All'
                        ? 'bg-sky-600 text-white shadow-xs ring-2 ring-sky-600/20'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200/80'
                    }`}
                  >
                    <span>All Departments</span>
                    <span
                      className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                        selectedDepartment === 'All'
                          ? 'bg-sky-700 text-sky-100'
                          : 'bg-slate-200 text-slate-600'
                      }`}
                    >
                      {departmentsWithCounts.reduce((sum, d) => sum + d.count, 0)}
                    </span>
                  </button>

                  {departmentsWithCounts.map((dept) => {
                    const isSelected = selectedDepartment.toLowerCase() === dept.name.toLowerCase();
                    return (
                      <button
                        key={dept.name}
                        type="button"
                        onClick={() => setSelectedDepartment(dept.name)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                          isSelected
                            ? 'bg-sky-600 text-white shadow-xs ring-2 ring-sky-600/20'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200/80'
                        }`}
                      >
                        <Building2
                          className={`w-3.5 h-3.5 ${
                            isSelected ? 'text-sky-100' : 'text-slate-500'
                          }`}
                        />
                        <span>{dept.name}</span>
                        <span
                          className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                            isSelected
                              ? 'bg-sky-700 text-sky-100'
                              : 'bg-slate-200 text-slate-600'
                          }`}
                        >
                          {dept.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Mobile Card List View (< 640px) */}
          <div className="block sm:hidden space-y-3">
            {displayedBatches.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-slate-500 shadow-xs">
                <Building2 className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="font-semibold text-slate-700 text-sm">
                  No routines found for department &ldquo;{selectedDepartment}&rdquo;
                </p>
                <button
                  type="button"
                  onClick={() => setSelectedDepartment('All')}
                  className="mt-2 text-xs font-semibold text-sky-600 hover:text-sky-800 underline cursor-pointer"
                >
                  View all departments
                </button>
              </div>
            ) : (
              displayedBatches.map((b, index) => {
                const StatusIcon = STATUS_ICON[b.status] || CheckCircle2;
                const displayNo = batches.length - index;
                return (
                  <div
                    key={b.id}
                    onClick={() => navigate(`/batches/${b.id}`)}
                    className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs hover:border-sky-400 active:bg-slate-50 transition-all cursor-pointer space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-bold text-sky-600 bg-sky-50 px-2 py-0.5 rounded-md border border-sky-200">
                          #{displayNo}
                        </span>
                        <h3 className="font-bold text-base text-slate-900 leading-tight">
                          {b.department || 'CSE'}
                        </h3>
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 text-[11px] font-semibold border px-2 py-0.5 rounded-full shrink-0 ${
                          STATUS_STYLES[b.status] || 'bg-slate-50 text-slate-700 border-slate-200'
                        }`}
                      >
                        <StatusIcon className="w-3 h-3" />
                        {String(b.status || 'unknown').replace(/_/g, ' ')}
                      </span>
                    </div>

                    <div className="text-xs text-slate-600 space-y-1">
                      {b.faculty && (
                        <p className="text-slate-500 font-medium">{b.faculty}</p>
                      )}
                      <div className="flex items-center gap-2 text-slate-700 font-semibold">
                        <Calendar className="w-3.5 h-3.5 text-ocean-600 shrink-0" />
                        <span>{b.year || '—'}</span>
                        {b.semester && <span className="font-normal text-slate-500">({b.semester})</span>}
                      </div>
                      <p className="text-[11px] text-slate-400">
                        Imported: {b.created_at ? new Date(b.created_at).toLocaleDateString() : '—'}
                      </p>
                    </div>

                    <div className="flex items-center justify-between pt-2.5 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={(e) => handleAskDelete(e, b)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 active:bg-red-200 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete
                      </button>
                      <div className="flex items-center gap-1 text-xs font-bold text-sky-600">
                        <span>View Schedule</span>
                        <ChevronRight className="w-4 h-4" />
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Desktop Table View (>= 640px) */}
          <div className="hidden sm:block bg-white border border-slate-200 rounded-2xl shadow-sm overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: '950px' }}>
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="text-left px-5 py-3 font-semibold w-16">#</th>
                  <th className="text-left px-5 py-3 font-semibold">Filename</th>
                  <th className="text-left px-5 py-3 font-semibold">Department</th>
                  <th className="text-left px-5 py-3 font-semibold">Year & Term</th>
                  <th className="text-left px-5 py-3 font-semibold">Status</th>
                  <th className="text-left px-5 py-3 font-semibold">Imported</th>
                  <th className="text-right px-5 py-3 font-semibold w-36">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayedBatches.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-12 text-center text-slate-500">
                      <Building2 className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                      <p className="font-semibold text-slate-700 text-sm">
                        No routines found for department &ldquo;{selectedDepartment}&rdquo;
                      </p>
                      <button
                        type="button"
                        onClick={() => setSelectedDepartment('All')}
                        className="mt-2 text-xs font-semibold text-sky-600 hover:text-sky-800 underline cursor-pointer"
                      >
                        View all departments
                      </button>
                    </td>
                  </tr>
                ) : (
                  displayedBatches.map((b, index) => {
                    const StatusIcon = STATUS_ICON[b.status] || CheckCircle2;
                    const displayNo = batches.length - index;
                    return (
                      <tr
                        key={b.id}
                        className="hover:bg-sky-50 transition-colors cursor-pointer"
                        onClick={() => navigate(`/batches/${b.id}`)}
                      >
                        <td className="px-5 py-3 text-slate-500 font-mono">#{displayNo}</td>
                        <td className="px-5 py-3 font-semibold text-slate-800 truncate max-w-[220px]">
                          {b.filename}
                        </td>
                        <td className="px-5 py-3 text-slate-700">
                          <div className="flex items-center gap-1.5 font-medium text-slate-800">
                            <Building2 className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                            <span className="truncate max-w-[180px]">{b.department || 'CSE'}</span>
                          </div>
                          {b.faculty && (
                            <div className="text-[11px] text-slate-400 truncate max-w-[180px] pl-5">
                              {b.faculty}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3 text-slate-700">
                          <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                            <Calendar className="w-3.5 h-3.5 text-ocean-600 shrink-0" />
                            <span>{b.year ? `${b.year}` : '—'}</span>
                            {b.semester && (
                              <span className="text-xs font-normal text-slate-600">
                                ({b.semester})
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex flex-col gap-1 items-start">
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
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded-full border border-sky-200">
                                scheduled
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-3 text-slate-500 text-xs whitespace-nowrap">
                          {b.created_at
                            ? new Date(b.created_at).toLocaleString()
                            : '—'}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="inline-flex items-center gap-3">
                            <button
                              type="button"
                              onClick={(e) => handleAskDelete(e, b)}
                              title={`Delete batch #${b.id}`}
                              aria-label={`Delete ${b.filename}`}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 transition-all border border-red-200/50 shadow-xs"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Delete
                            </button>
                            <ChevronRight className="w-4 h-4 text-slate-400" />
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <DeleteConfirmModal
        target={deleteTarget}
        busy={deleting}
        onCancel={() => !deleting && setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
};

/**
 * Small confirmation modal — no portal, no animation library;
 * Tailwind + lucide only. Renders null when there's no target,
 * so it doesn't add any node to the tree on the happy path.
 */
function DeleteConfirmModal({ target, busy, onCancel, onConfirm }) {
  if (!target) return null;
  const filename = target.filename || `batch #${target.id}`;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-modal-title"
      onClick={(e) => {
        // Close on backdrop click unless a delete is in-flight.
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2 text-slate-800 font-semibold">
            <Trash2 className="w-5 h-5 text-red-500" />
            <span id="delete-modal-title">Delete upload batch?</span>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 disabled:opacity-30"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-5 space-y-3 text-sm text-slate-700">
          <p className="leading-relaxed">
            You're about to permanently delete{' '}
            <span className="font-mono font-semibold text-slate-900 break-all">
              {filename}
            </span>
            .
          </p>
          <ul className="list-disc list-inside text-xs text-slate-500 space-y-0.5">
            <li>All imported teachers, courses, and rooms will be cleared.</li>
            <li>Credit rules, room/teacher preferences, and any saved schedule will also be removed.</li>
            <li>This action cannot be undone.</li>
          </ul>
        </div>
        <div className="px-5 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-200 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-red-600 hover:bg-red-500 text-white transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            {busy ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Deleting…
              </>
            ) : (
              <>
                <Trash2 className="w-4 h-4" /> Yes, delete
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default HistoryPage;
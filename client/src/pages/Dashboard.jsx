import { useState, useEffect } from 'react';
import { masterApi } from '../api/client';
import { Layers, Trash2, Calendar, UploadCloud, Shield, AlertTriangle, Waves } from 'lucide-react';
import FileUpload from '../components/FileUpload';
import SpreadsheetEditor from '../components/SpreadsheetEditor';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/client';
import toast from 'react-hot-toast';

const Dashboard = () => {
  const [semesters, setSemesters] = useState([]);
  const [report, setReport] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [editingDept, setEditingDept] = useState(null);
  const { user } = useAuth();

  useEffect(() => { fetchSemesters(); }, []);

  const fetchSemesters = async () => {
    try {
      const res = await masterApi.getSemesters();
      setSemesters(res.data.data);
    } catch (e) { console.error(e); }
  };

  const handleUploadSuccess = (importReport) => {
    setReport(importReport);
    fetchSemesters();
  };

  const handleDelete = async (semId, semName) => {
    if (!window.confirm(`Delete semester "${semName}" and ALL its routine data? This cannot be undone.`)) return;
    setDeletingId(semId);
    try {
      await api.delete(`/semesters/${semId}`);
      toast.success(`"${semName}" deleted.`);
      setSemesters(prev => prev.filter(s => s.id !== semId));
      setReport(null);
    } catch {
      toast.error('Failed to delete semester.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleEditorClose = () => {
    setEditingDept(null);
    fetchSemesters(); // Refresh data in case it was updated
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-12">
      {editingDept && (
        <SpreadsheetEditor
          semesterId={editingDept.semesterId}
          deptCode={editingDept.deptCode}
          semesterName={editingDept.semesterName}
          onClose={handleEditorClose}
        />
      )}

      {/* ── Page Header ── */}
      <div className="relative overflow-hidden rounded-2xl bg-linear-to-br from-ocean-900 to-ocean-800 px-8 py-6 shadow-lg border border-sky-500/15">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-10 -right-10 w-48 h-48 rounded-full bg-sky-500/10 blur-3xl" />
        </div>
        <div className="relative flex items-center gap-3">
          <div className="bg-sky-400/20 p-2.5 rounded-xl border border-sky-400/20">
            <Shield className="w-5 h-5 text-sky-400" />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <Waves className="w-3.5 h-3.5 text-sky-400" />
              <span className="text-xs font-semibold tracking-widest uppercase text-sky-400">Admin Panel</span>
            </div>
            <h1 className="text-2xl font-bold text-white">Dashboard</h1>
            <p className="text-sky-300 text-sm">Logged in as <span className="font-semibold text-white">{user?.email}</span></p>
          </div>
        </div>
      </div>

      {/* ── Upload + Report ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <FileUpload onUploadSuccess={handleUploadSuccess} />

        <div>
          {report ? (
            <div className="bg-sky-50 border border-sky-200 rounded-2xl p-6 h-full">
              <h3 className="text-base font-semibold text-sky-900 mb-4 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-sky-500 shrink-0" />
                Import Successful
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Departments', value: report.departments },
                  { label: 'Teachers', value: report.teachers },
                  { label: 'Rooms', value: report.rooms },
                  { label: 'Courses', value: report.courses },
                  { label: 'Sections', value: report.sections },
                  { label: 'Routine Entries', value: report.routineEntries },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-white p-3 rounded-xl border border-sky-100 shadow-sm">
                    <p className="text-xs text-slate-400 mb-0.5">{label}</p>
                    <p className="font-bold text-xl text-ocean-800">{value}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="bg-white border border-dashed border-ocean-200 rounded-2xl p-8 h-full flex flex-col justify-center items-center text-slate-400 gap-3">
              <Layers className="w-12 h-12 text-ocean-200" />
              <p className="text-sm text-center">Upload a routine file to see import statistics here.</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Format reminder ── */}
      <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm">
        <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
        <div className="text-amber-800">
          <span className="font-semibold">Upload Guide:</span>{' '}
          Uploads update the class routine for the departments present in your Excel file.
          If a semester (e.g. <em>January-July 2025</em>) already exists, uploading will add/update the department in that semester without creating duplicates.{' '}
          <button
            className="underline text-amber-700 hover:text-amber-900 font-semibold"
            onClick={async () => {
              const { templateApi } = await import('../api/client');
              const id = toast.loading('Preparing template...');
              try {
                const res = await templateApi.download();
                const url = window.URL.createObjectURL(new Blob([res.data]));
                const a = document.createElement('a'); a.href = url;
                a.download = 'Routine_Template.xlsx'; a.click();
                window.URL.revokeObjectURL(url);
                toast.success('Template downloaded.', { id });
              } catch { toast.error('Download failed.', { id }); }
            }}
          >
            Download Template ↓
          </button>
        </div>
      </div>

      {/* ── Semesters ── */}
      <div>
        <div className="flex items-center gap-2 mb-5">
          <Calendar className="w-5 h-5 text-ocean-600" />
          <h2 className="text-xl font-bold text-ocean-900">Uploaded Semesters</h2>
          <span className="ml-auto text-sm text-slate-400 bg-ocean-50 border border-ocean-100 px-2.5 py-0.5 rounded-full">
            {semesters.length} total
          </span>
        </div>

        {semesters.length > 0 ? (
          <div className="space-y-8">
            {semesters.map(sem => (
              <div key={sem.id} className="space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-ocean-100">
                  <div>
                    <h3 className="font-bold text-lg text-ocean-900">{sem.name}</h3>
                    <p className="text-xs text-slate-500">
                      Academic Year: {sem.year} &bull; Imported {new Date(sem.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDelete(sem.id, sem.name)}
                    disabled={deletingId === sem.id}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 transition-colors disabled:opacity-50"
                    title="Delete entire semester"
                  >
                    <Trash2 className="w-4 h-4" /> Delete Semester
                  </button>
                </div>

                {/* Department Cards */}
                {sem.departments && sem.departments.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {sem.departments.map(dept => (
                      <div
                        key={dept.id}
                        onClick={() => setEditingDept({ semesterId: sem.id, deptCode: dept.deptCode, semesterName: sem.name })}
                        className="bg-white p-5 rounded-xl border border-ocean-200 shadow-sm hover:shadow-md hover:border-ocean-400 hover:ring-2 hover:ring-ocean-100 transition-all cursor-pointer flex items-center justify-between group"
                      >
                        <div>
                          <h4 className="font-bold text-ocean-800 text-lg">{dept.deptCode}</h4>
                        </div>
                        <div className="bg-sky-50 text-sky-600 p-2 rounded-lg group-hover:bg-sky-500 group-hover:text-white transition-colors">
                          <Layers className="w-5 h-5" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400 italic">No departments found for this semester.</p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-ocean-50 rounded-xl p-10 text-center border border-dashed border-ocean-200">
            <UploadCloud className="w-10 h-10 mx-auto mb-3 text-ocean-300" />
            <p className="text-sm text-slate-400">No semesters yet. Upload a routine Excel file to get started.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;

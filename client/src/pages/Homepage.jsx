import { useState, useEffect, useRef } from 'react';
import TimetableGrid from '../components/TimetableGrid';
import { routineApi, masterApi } from '../api/client';
import {
  Loader2, Download, ChevronDown, Sparkles,
  Cpu, Atom, Leaf, BookOpen, Briefcase, GraduationCap, Waves,
  FileText, ArrowRight
} from 'lucide-react';
import toast from 'react-hot-toast';

// ── Faculty palette ─────────────────────────────────────────────
// Each faculty gets its own distinct gradient family so cards feel
// visually separated and easy to scan.
const FACULTY_CONFIG = {
  Engineering: {
    icon: Cpu,
    label: 'Engineering',
    accent: 'indigo',
    gradient: 'bg-gradient-to-br from-indigo-500 via-indigo-600 to-violet-700',
    cardBg: 'bg-white',
    hoverBorder: 'hover:border-indigo-400',
    selectedBorder: 'border-indigo-500',
    selectedBg: 'bg-gradient-to-br from-indigo-50 via-white to-violet-50',
    selectedChip: 'bg-indigo-500 text-white',
    dot: 'bg-indigo-500',
    divider: 'from-indigo-200 via-indigo-300 to-transparent',
    hoverRing: 'hover:ring-2 hover:ring-indigo-100',
    selectedTag: 'text-indigo-700',
    hoverTag: 'group-hover:text-indigo-700',
    iconBg: 'bg-slate-50 text-slate-500',
  },
  Science: {
    icon: Atom,
    label: 'Science',
    accent: 'cyan',
    gradient: 'bg-gradient-to-br from-cyan-500 via-cyan-600 to-sky-700',
    cardBg: 'bg-white',
    hoverBorder: 'hover:border-cyan-400',
    selectedBorder: 'border-cyan-500',
    selectedBg: 'bg-gradient-to-br from-cyan-50 via-white to-sky-50',
    selectedChip: 'bg-cyan-500 text-white',
    dot: 'bg-cyan-500',
    divider: 'from-cyan-200 via-cyan-300 to-transparent',
    hoverRing: 'hover:ring-2 hover:ring-cyan-100',
    selectedTag: 'text-cyan-700',
    hoverTag: 'group-hover:text-cyan-700',
    iconBg: 'bg-slate-50 text-slate-500',
  },
  'Life Science': {
    icon: Leaf,
    label: 'Life Science',
    accent: 'emerald',
    gradient: 'bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-700',
    cardBg: 'bg-white',
    hoverBorder: 'hover:border-emerald-400',
    selectedBorder: 'border-emerald-500',
    selectedBg: 'bg-gradient-to-br from-emerald-50 via-white to-teal-50',
    selectedChip: 'bg-emerald-500 text-white',
    dot: 'bg-emerald-500',
    divider: 'from-emerald-200 via-emerald-300 to-transparent',
    hoverRing: 'hover:ring-2 hover:ring-emerald-100',
    selectedTag: 'text-emerald-700',
    hoverTag: 'group-hover:text-emerald-700',
    iconBg: 'bg-slate-50 text-slate-500',
  },
  Humanities: {
    icon: BookOpen,
    label: 'Humanities',
    accent: 'amber',
    gradient: 'bg-gradient-to-br from-amber-500 via-orange-500 to-rose-600',
    cardBg: 'bg-white',
    hoverBorder: 'hover:border-amber-400',
    selectedBorder: 'border-amber-500',
    selectedBg: 'bg-gradient-to-br from-amber-50 via-white to-orange-50',
    selectedChip: 'bg-amber-500 text-white',
    dot: 'bg-amber-500',
    divider: 'from-amber-200 via-orange-300 to-transparent',
    hoverRing: 'hover:ring-2 hover:ring-amber-100',
    selectedTag: 'text-amber-700',
    hoverTag: 'group-hover:text-amber-700',
    iconBg: 'bg-slate-50 text-slate-500',
  },
  Business: {
    icon: Briefcase,
    label: 'Business',
    accent: 'rose',
    gradient: 'bg-gradient-to-br from-rose-500 via-pink-600 to-fuchsia-700',
    cardBg: 'bg-white',
    hoverBorder: 'hover:border-rose-400',
    selectedBorder: 'border-rose-500',
    selectedBg: 'bg-gradient-to-br from-rose-50 via-white to-pink-50',
    selectedChip: 'bg-rose-500 text-white',
    dot: 'bg-rose-500',
    divider: 'from-rose-200 via-pink-300 to-transparent',
    hoverRing: 'hover:ring-2 hover:ring-rose-100',
    selectedTag: 'text-rose-700',
    hoverTag: 'group-hover:text-rose-700',
    iconBg: 'bg-slate-50 text-slate-500',
  },
  Other: {
    icon: GraduationCap,
    label: 'Other',
    accent: 'slate',
    gradient: 'bg-gradient-to-br from-slate-500 via-slate-600 to-slate-800',
    cardBg: 'bg-white',
    hoverBorder: 'hover:border-slate-400',
    selectedBorder: 'border-slate-500',
    selectedBg: 'bg-gradient-to-br from-slate-50 via-white to-slate-100',
    selectedChip: 'bg-slate-600 text-white',
    dot: 'bg-slate-500',
    divider: 'from-slate-200 via-slate-300 to-transparent',
    hoverRing: 'hover:ring-2 hover:ring-slate-100',
    selectedTag: 'text-slate-700',
    hoverTag: 'group-hover:text-slate-700',
    iconBg: 'bg-slate-50 text-slate-500',
  },
};

const FACULTY_ORDER = ['Engineering', 'Science', 'Life Science', 'Humanities', 'Business', 'Other'];

const Homepage = () => {
  const [semesters, setSemesters] = useState([]);
  const [selectedDept, setSelectedDept] = useState(null);
  const [selectedSemesterId, setSelectedSemesterId] = useState('');
  const [routineEntries, setRoutineEntries] = useState([]);
  const [loadingPage, setLoadingPage] = useState(true);
  const [loadingRoutine, setLoadingRoutine] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const routineRef = useRef(null);

  // ── Initial load ──
  useEffect(() => {
    masterApi.getSemesters()
      .then(res => setSemesters(res.data.data))
      .catch(console.error)
      .finally(() => setLoadingPage(false));
  }, []);

  const allDepartments = semesters.flatMap(sem =>
    (sem.departments || []).map(dept => ({
      ...dept,
      semesterName: sem.name,
      semesterId: sem.id
    }))
  );

  // ── Routine fetch ──
  useEffect(() => {
    if (!selectedDept || !selectedSemesterId) return;
    setLoadingRoutine(true);
    setRoutineEntries([]);
    routineApi.getRoutine({ semesterId: selectedSemesterId, department: selectedDept.deptCode })
      .then(res => setRoutineEntries(res.data.data))
      .catch(() => toast.error('Failed to load routine.'))
      .finally(() => setLoadingRoutine(false));
  }, [selectedDept, selectedSemesterId]);

  const handleDeptClick = (dept) => {
    setSelectedDept(dept);
    setSelectedSemesterId(dept.semesterId);
    setTimeout(() => routineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
  };

  // ── Group by faculty ──
  const grouped = allDepartments.reduce((acc, dept) => {
    const f = dept.faculty || 'Other';
    if (!acc[f]) acc[f] = [];
    acc[f].push(dept);
    return acc;
  }, {});
  const activeFaculties = FACULTY_ORDER.filter(f => grouped[f]?.length > 0);

  // ── PDF Download (server-side via pdfkit) ──
  // Use plain `fetch` (not the axios instance) so no `Authorization` header is
  // attached — that keeps the request "simple" and avoids a CORS preflight
  // (the dev proxy and certain browsers mishandle OPTIONS for blob responses).
  const downloadPDF = async () => {
    if (!selectedDept || !selectedSemesterId) return;
    const toastId = toast.loading('Generating PDF...');
    setDownloadingPdf(true);
    try {
      const semName = semesters.find(s => s.id === selectedSemesterId)?.name || 'Routine';
      const safeSem = semName.replace(/[^a-zA-Z0-9]+/g, '_');
      const url = `/api/semesters/${encodeURIComponent(selectedSemesterId)}/departments/${encodeURIComponent(selectedDept.deptCode)}/export-pdf`;

      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const blob = await res.blob();
      const objectUrl = window.URL.createObjectURL(blob);

      // Pull a friendly filename from the response headers if the server set one.
      const dispo = res.headers.get('content-disposition') || '';
      const match = dispo.match(/filename="?([^";]+)"?/i);
      const filename = match?.[1] || `${selectedDept.deptCode}_${safeSem}.pdf`;

      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(objectUrl);
      toast.success('PDF downloaded!', { id: toastId });
    } catch (err) {
      console.error(err);
      toast.error('Failed to export PDF.', { id: toastId });
    } finally {
      setDownloadingPdf(false);
    }
  };

  const currentSemName = semesters.find(s => s.id === selectedSemesterId)?.name || '';
  const selectedFacultyCfg = selectedDept ? FACULTY_CONFIG[selectedDept.faculty] || FACULTY_CONFIG.Other : null;

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 space-y-10 pb-12">

      {/* ── HERO ── */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white px-8 py-10 shadow-2xl border border-white/10">
        {/* Ambient blobs */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute -top-20 -right-20 w-80 h-80 rounded-full bg-indigo-500/20 blur-3xl" />
          <div className="absolute -bottom-16 -left-16 w-72 h-72 rounded-full bg-cyan-500/20 blur-3xl" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full bg-violet-500/10 blur-3xl" />
          {/* Subtle grid pattern */}
          <div className="absolute inset-0 opacity-[0.04]" style={{
            backgroundImage: 'linear-gradient(rgba(255,255,255,.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.5) 1px, transparent 1px)',
            backgroundSize: '32px 32px'
          }} />
        </div>

        <div className="relative flex items-center justify-between flex-wrap gap-6">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 mb-3 px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm border border-white/15">
              <Waves className="w-3.5 h-3.5 text-cyan-300" />
              <span className="text-[10px] font-semibold tracking-[0.18em] uppercase text-cyan-200">
                University Name
              </span>
            </div>
            <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight text-white mb-2 leading-tight">
              Class Routine
              <Sparkles className="inline-block w-7 h-7 ml-2 text-amber-300 -mt-1" />
            </h1>
            <p className="text-slate-300 text-sm md:text-base max-w-xl leading-relaxed">
              Browse official class schedules by faculty and department. Select a department to
              view its full weekly routine and download a printable PDF.
            </p>
          </div>

          {/* Stats card */}
          <div className="hidden md:flex items-stretch gap-3">
            <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl px-5 py-4 min-w-[120px]">
              <p className="text-2xl font-bold text-white">{allDepartments.length}</p>
              <p className="text-[10px] uppercase tracking-widest text-slate-400 mt-0.5">Departments</p>
            </div>
            <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl px-5 py-4 min-w-[120px]">
              <p className="text-2xl font-bold text-white">{activeFaculties.length}</p>
              <p className="text-[10px] uppercase tracking-widest text-slate-400 mt-0.5">Faculties</p>
            </div>
            <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl px-5 py-4 min-w-[120px]">
              <p className="text-2xl font-bold text-white">{semesters.length}</p>
              <p className="text-[10px] uppercase tracking-widest text-slate-400 mt-0.5">Semesters</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── LOADING ── */}
      {loadingPage && (
        <div className="flex items-center justify-center py-24">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-10 h-10 animate-spin text-indigo-500" />
            <p className="text-sm text-slate-400">Loading departments...</p>
          </div>
        </div>
      )}

      {/* ── EMPTY STATE ── */}
      {!loadingPage && allDepartments.length === 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center shadow-sm">
          <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center">
            <GraduationCap className="w-10 h-10 text-slate-400" />
          </div>
          <h3 className="text-lg font-semibold text-slate-700 mb-1">No Routine Available</h3>
          <p className="text-slate-400 text-sm max-w-md mx-auto">
            No departments found. An admin needs to upload a routine first.
          </p>
        </div>
      )}

      {/* ── FACULTY + DEPARTMENT GRID ── */}
      {!loadingPage && activeFaculties.length > 0 && (
        <div className="space-y-12">
          {activeFaculties.map(faculty => {
            const cfg = FACULTY_CONFIG[faculty] || FACULTY_CONFIG.Other;
            const Icon = cfg.icon;
            const depts = grouped[faculty];
            return (
              <section key={faculty}>
                {/* Faculty Header */}
                <div className="flex items-center gap-4 mb-6">
                  <div className={`${cfg.gradient} p-3 rounded-2xl shadow-lg shrink-0 ring-1 ring-white/20`}>
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-xl font-bold text-slate-900 leading-tight">
                      Faculty of {faculty}
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {depts.length} department{depts.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <div className={`flex-1 h-px bg-gradient-to-r ${cfg.divider} ml-2 hidden sm:block`} />
                </div>

                {/* Department Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                  {depts.map(dept => {
                    const isSel = selectedDept?.deptCode === dept.deptCode && selectedSemesterId === dept.semesterId;
                    return (
                      <button
                        key={`${dept.semesterId}-${dept.id}`}
                        id={`dept-${dept.deptCode}-${dept.semesterId}`}
                        onClick={() => handleDeptClick(dept)}
                        className={`group relative overflow-hidden rounded-2xl border-2 text-left transition-all duration-300 cursor-pointer
                          ${isSel
                            ? `${cfg.selectedBorder} ${cfg.selectedBg} shadow-xl scale-[1.02]`
                            : `${cfg.cardBg} border-slate-200 ${cfg.hoverBorder} ${cfg.hoverRing} shadow-sm hover:shadow-md hover:-translate-y-1`
                          }`}
                      >
                        {/* Top gradient strip */}
                        <div className={`h-1.5 w-full ${cfg.gradient}`} />

                        <div className="p-5 flex flex-col gap-2">
                          {/* Icon + check */}
                          <div className="flex items-start justify-between">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all
                              ${isSel
                                ? `${cfg.gradient} text-white shadow-md`
                                : `${cfg.iconBg} ${cfg.hoverTag}`
                              }`}>
                              <Icon className="w-5 h-5" />
                            </div>
                            {isSel && (
                              <span className={`${cfg.selectedChip} text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full shadow-sm`}>
                                Selected
                              </span>
                            )}
                          </div>

                          <h4 className={`text-2xl font-extrabold tracking-tight mt-1
                            ${isSel ? 'text-slate-900' : 'text-slate-800'}`}>
                            {dept.deptCode}
                          </h4>
                          <p className={`text-xs font-medium leading-snug line-clamp-2 min-h-[2rem]
                            ${isSel ? 'text-slate-600' : 'text-slate-500'}`}>
                            {dept.deptName || dept.semesterName}
                          </p>

                          {/* Footer row */}
                          <div className={`flex items-center justify-between mt-2 pt-3 border-t ${isSel ? 'border-slate-200' : 'border-slate-100'}`}>
                            <span className={`text-[10px] font-semibold uppercase tracking-wider ${isSel ? cfg.selectedTag : 'text-slate-400'}`}>
                              {dept.semesterName}
                            </span>
                            <ArrowRight className={`w-4 h-4 transition-transform
                              ${isSel
                                ? `${cfg.selectedTag} translate-x-0`
                                : `text-slate-300 group-hover:translate-x-1 ${cfg.hoverTag}`
                              }`} />
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* ── ROUTINE VIEWER ── */}
      {selectedDept && (
        <div ref={routineRef} className="space-y-5 pt-8 border-t-2 border-slate-200">

          {/* Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 rounded-2xl ${selectedFacultyCfg?.gradient || 'bg-slate-700'} flex items-center justify-center shadow-md ring-1 ring-white/20`}>
                {selectedFacultyCfg?.icon &&
                  (() => {
                    const Icon = selectedFacultyCfg.icon;
                    return <Icon className="w-6 h-6 text-white" />;
                  })()}
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900 leading-tight">
                  {selectedDept.deptCode}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Class Routine · {currentSemName}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Semester Dropdown */}
              <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-sm hover:border-indigo-400 transition-colors">
                <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                <select
                  id="semester-select"
                  className="text-sm font-medium text-slate-700 outline-none bg-transparent cursor-pointer pr-1"
                  value={selectedSemesterId}
                  onChange={e => setSelectedSemesterId(e.target.value)}
                >
                  {semesters.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              {/* PDF Download */}
              {routineEntries.length > 0 && (
                <button
                  id="download-pdf"
                  onClick={downloadPDF}
                  disabled={downloadingPdf}
                  className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-semibold rounded-xl shadow-md hover:shadow-lg transition-all text-sm disabled:opacity-60 disabled:cursor-wait"
                >
                  {downloadingPdf ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  {downloadingPdf ? 'Generating…' : 'Download PDF'}
                </button>
              )}
            </div>
          </div>

          {/* Grid */}
          <div className="relative min-h-[200px]">
            {loadingRoutine && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/80 backdrop-blur-sm z-10 rounded-xl">
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="w-10 h-10 animate-spin text-indigo-500" />
                  <p className="text-xs text-slate-500">Loading routine…</p>
                </div>
              </div>
            )}

            {!loadingRoutine && routineEntries.length === 0 && (
              <div className="bg-white border border-dashed border-slate-300 rounded-xl p-12 text-center">
                <FileText className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                <p className="text-sm text-slate-500">No routine entries found for this selection.</p>
              </div>
            )}

            {routineEntries.length > 0 && (
              <div id="timetable-container" className="rounded-xl overflow-hidden shadow-[0_8px_30px_rgba(15,23,42,0.08)] border border-slate-200 bg-white">
                <TimetableGrid
                  entries={routineEntries}
                  semesterName={currentSemName}
                  departmentName={selectedDept.deptName}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Homepage;

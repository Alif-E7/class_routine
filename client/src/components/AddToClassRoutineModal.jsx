import { useState, useMemo } from 'react';
import { X, BookmarkPlus, Loader2, Building2, GraduationCap, Calendar, Clock } from 'lucide-react';
import toast from 'react-hot-toast';
import { classRoutineApi } from '../api/client';

const FACULTY_DEPARTMENTS = {
  Engineering: [
    'CSE',
    'EEE',
    'ETE',
    'ACCE',
    'CE',
    'Food and Agroprocess Engineering',
    'ARCH',
  ],
  Science: [
    'Mathematics',
    'Statistics',
    'Chemistry',
    'Physics',
    'ESDM',
  ],
  'Life Science': [
    'Pharmacy',
    'BGE',
    'BMB',
    'Botany',
  ],
  Humanities: [
    'English',
    'Bangla',
    'History',
  ],
  'Social Science': [
    'Psychology',
    'Sociology',
    'PAD',
    'IR',
    'Economics',
    'PS',
  ],
  'Business Studies': [
    'Management Studies',
    'AIS',
    'Marketing',
    'Finance and Banking',
    'THM',
  ],
  Law: [
    'Law',
  ],
  Agriculture: [
    'Agriculture',
    'FMB',
  ],
  'Animal Science and Veterinary Medicine': [
    'ASVM',
  ],
};

const DEPT_FACULTY_MAP = {};
Object.entries(FACULTY_DEPARTMENTS).forEach(([fac, depts]) => {
  depts.forEach((dept) => {
    DEPT_FACULTY_MAP[dept] = fac;
  });
});

const DEPARTMENTS = Object.values(FACULTY_DEPARTMENTS).flat();

const ABBR_MAP = {
  CSE: 'Computer Science and Engineering',
  EEE: 'Electrical and Electronic Engineering',
  ETE: 'Electronics and Telecommunication Engineering',
  ACCE: 'Applied Chemistry and Chemical Engineering',
  CE: 'Civil Engineering',
  FAPE: 'Food and Agroprocess Engineering',
  ESDM: 'Environmental Science and Disaster Management',
  BGE: 'Biotechnology and Genetic Engineering',
  BMB: 'Biochemistry and Molecular Biology',
  AIS: 'Accounting and Information Systems',
  THM: 'Tourism and Hospitality Management',
  FMB: 'Fisheries and Marine Bioscience',
  ASVM: 'Animal Science and Veterinary Medicine',
};

function resolveDepartment(def) {
  if (!def || typeof def !== 'string') return DEPARTMENTS[0];
  const cleaned = def.trim();
  if (!cleaned) return DEPARTMENTS[0];

  const upper = cleaned.toUpperCase();
  if (ABBR_MAP[upper]) return ABBR_MAP[upper];

  const exact = DEPARTMENTS.find((d) => d.toLowerCase() === cleaned.toLowerCase());
  if (exact) return exact;

  const partial = DEPARTMENTS.find(
    (d) => d.toLowerCase().includes(cleaned.toLowerCase()) || cleaned.toLowerCase().includes(d.toLowerCase())
  );
  if (partial) return partial;

  return cleaned;
}

const FACULTIES = [
  'Engineering',
  'Science',
  'Life Science',
  'Humanities',
  'Social Science',
  'Business Studies',
  'Law',
  'Animal Science and Veterinary Medicine',
  'Agriculture',
];

const TERMS = ['Fall', 'Spring'];

const DEFAULT_YEARS = ['2026', '2025', '2027', '2024', '2028'];

const AddToClassRoutineModal = ({
  batchId,
  defaultDepartment = '',
  defaultFaculty = '',
  defaultYear = '',
  defaultTerm = '',
  onClose,
  onSuccess,
}) => {
  const initialDept = resolveDepartment(defaultDepartment);
  const matchedFac = defaultFaculty
    ? (FACULTIES.find((f) => f.toLowerCase() === String(defaultFaculty).toLowerCase() || String(defaultFaculty).toLowerCase().includes(f.toLowerCase())) || defaultFaculty)
    : (DEPT_FACULTY_MAP[initialDept] || 'Engineering');
  const initialFac = matchedFac;
  const initialYear = defaultYear ? String(defaultYear).trim() : '2026';
  const initialTerm = (defaultTerm && TERMS.find(t => t.toLowerCase() === String(defaultTerm).toLowerCase())) || (defaultTerm ? String(defaultTerm).trim() : 'Fall');

  const yearOptions = useMemo(() => {
    const set = new Set(['2024', '2025', '2026', '2027', '2028', '2029', '2030']);
    if (initialYear) set.add(initialYear);
    return Array.from(set).sort();
  }, [initialYear]);

  const [faculty, setFaculty] = useState(initialFac);
  const [department, setDepartment] = useState(initialDept);
  const [year, setYear] = useState(initialYear);
  const [customYear, setCustomYear] = useState('');
  const [isCustomYear, setIsCustomYear] = useState(false);
  const [term, setTerm] = useState(initialTerm);
  const [saving, setSaving] = useState(false);

  const handleFacultyChange = (newFac) => {
    setFaculty(newFac);
    const availableDepts = FACULTY_DEPARTMENTS[newFac] || [];
    if (!availableDepts.includes(department)) {
      setDepartment(availableDepts[0] || '');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const finalYear = isCustomYear ? customYear.trim() : year;

    if (!department.trim()) {
      toast.error('Please select a Department.');
      return;
    }
    if (!finalYear) {
      toast.error('Please enter or select a Year (e.g. 2026).');
      return;
    }

    setSaving(true);
    const toastId = toast.loading('Adding to Class Routines...');

    try {
      const res = await classRoutineApi.create({
        batchId,
        batch_id: batchId,
        department: department.trim(),
        faculty,
        year: finalYear,
        term,
      });

      const isOverwritten = res.data?.overwritten;
      const successMsg = isOverwritten
        ? `Previous routine for ${department.trim()} overwritten with new schedule!`
        : `Added to Class Routines under ${faculty} -> ${department.trim()}!`;

      toast.success(successMsg, { id: toastId });
      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Failed to save to Class Routines.', { id: toastId });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg overflow-hidden bg-white rounded-3xl shadow-2xl border border-slate-200 animate-in zoom-in-95 duration-200">

        {/* Header strip */}
        <div className="relative bg-gradient-to-r from-ocean-950 via-ocean-900 to-indigo-950 text-white px-6 py-5 border-b border-sky-500/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-sky-400 to-indigo-600 shadow-md">
                <BookmarkPlus className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="text-lg font-bold tracking-tight text-white">Add to Class Routine</h3>
                <p className="text-xs text-sky-200 mt-0.5">Publish this routine batch to the main Class Routines page</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-sky-300 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">

          {/* 1. Faculty Dropdown (First) */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-700">
              <GraduationCap className="w-4 h-4 text-indigo-500" />
              Faculty
            </label>
            <select
              value={faculty}
              onChange={(e) => handleFacultyChange(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all bg-white cursor-pointer"
            >
              {FACULTIES.map((fac) => (
                <option key={fac} value={fac}>
                  {fac}
                </option>
              ))}
            </select>
          </div>

          {/* 2. Department Dropdown (Second — filtered by selected Faculty) */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-700">
              <Building2 className="w-4 h-4 text-indigo-500" />
              Department
            </label>
            <select
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all bg-white cursor-pointer"
            >
              {(FACULTY_DEPARTMENTS[faculty] || DEPARTMENTS).map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select>
          </div>

          {/* Grid: Year & Term */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Year */}
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-700">
                <Calendar className="w-4 h-4 text-indigo-500" />
                Year
              </label>

              {!isCustomYear ? (
                <div className="flex gap-2">
                  <select
                    value={year}
                    onChange={(e) => {
                      if (e.target.value === 'custom') {
                        setIsCustomYear(true);
                      } else {
                        setYear(e.target.value);
                      }
                    }}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all bg-white cursor-pointer"
                  >
                    {yearOptions.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                    <option value="custom">Enter custom year...</option>
                  </select>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="text"
                    required
                    placeholder="e.g. 2026"
                    value={customYear}
                    onChange={(e) => setCustomYear(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all bg-slate-50/50"
                  />
                  <button
                    type="button"
                    onClick={() => setIsCustomYear(false)}
                    className="px-2.5 py-2 text-xs text-indigo-600 hover:text-indigo-800 font-semibold underline shrink-0"
                  >
                    List
                  </button>
                </div>
              )}
            </div>

            {/* Term Dropdown */}
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-700">
                <Clock className="w-4 h-4 text-indigo-500" />
                Term
              </label>
              <select
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all bg-white cursor-pointer"
              >
                {TERMS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2.5 text-sm font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-sky-500 via-indigo-600 to-violet-600 hover:from-sky-600 hover:to-violet-700 rounded-xl shadow-md hover:shadow-lg transition-all flex items-center gap-2 disabled:opacity-60"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookmarkPlus className="w-4 h-4" />}
              {saving ? 'Saving...' : 'Add to Class Routine'}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
};

export default AddToClassRoutineModal;

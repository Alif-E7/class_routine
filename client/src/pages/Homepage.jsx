import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { classRoutineApi } from '../api/client';
import {
  Loader2, Sparkles,
  Cpu, Atom, Leaf, BookOpen, Users, Briefcase, Scale, Stethoscope, Sprout,
  GraduationCap, Waves, ArrowRight, Trash2, Calendar, Search, Filter, Layers, LayoutGrid
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';

/* ── Faculty Configuration (9 faculties) ────────────────────────── */
const FACULTY_CONFIG = {
  Engineering: {
    icon: Cpu,
    gradient: 'from-indigo-500 to-violet-600',
    chip: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    accent: 'text-indigo-600',
    bar: 'bg-indigo-500',
    ring: 'ring-indigo-200',
    dividerColor: '#6366f1',
  },
  Science: {
    icon: Atom,
    gradient: 'from-cyan-500 to-sky-600',
    chip: 'bg-cyan-50 text-cyan-700 border-cyan-200',
    accent: 'text-cyan-600',
    bar: 'bg-cyan-500',
    ring: 'ring-cyan-200',
    dividerColor: '#06b6d4',
  },
  'Life Science': {
    icon: Leaf,
    gradient: 'from-emerald-500 to-teal-600',
    chip: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    accent: 'text-emerald-600',
    bar: 'bg-emerald-500',
    ring: 'ring-emerald-200',
    dividerColor: '#10b981',
  },
  Humanities: {
    icon: BookOpen,
    gradient: 'from-amber-500 to-orange-600',
    chip: 'bg-amber-50 text-amber-700 border-amber-200',
    accent: 'text-amber-600',
    bar: 'bg-amber-500',
    ring: 'ring-amber-200',
    dividerColor: '#f59e0b',
  },
  'Social Science': {
    icon: Users,
    gradient: 'from-purple-500 to-fuchsia-600',
    chip: 'bg-purple-50 text-purple-700 border-purple-200',
    accent: 'text-purple-600',
    bar: 'bg-purple-500',
    ring: 'ring-purple-200',
    dividerColor: '#a855f7',
  },
  'Business Studies': {
    icon: Briefcase,
    gradient: 'from-rose-500 to-pink-600',
    chip: 'bg-rose-50 text-rose-700 border-rose-200',
    accent: 'text-rose-600',
    bar: 'bg-rose-500',
    ring: 'ring-rose-200',
    dividerColor: '#f43f5e',
  },
  Law: {
    icon: Scale,
    gradient: 'from-slate-600 to-gray-800',
    chip: 'bg-slate-100 text-slate-700 border-slate-300',
    accent: 'text-slate-700',
    bar: 'bg-slate-600',
    ring: 'ring-slate-300',
    dividerColor: '#475569',
  },
  'Animal Science and Veterinary Medicine': {
    icon: Stethoscope,
    gradient: 'from-teal-500 to-emerald-700',
    chip: 'bg-teal-50 text-teal-700 border-teal-200',
    accent: 'text-teal-600',
    bar: 'bg-teal-500',
    ring: 'ring-teal-200',
    dividerColor: '#14b8a6',
  },
  Agriculture: {
    icon: Sprout,
    gradient: 'from-lime-600 to-green-700',
    chip: 'bg-lime-50 text-lime-800 border-lime-200',
    accent: 'text-lime-700',
    bar: 'bg-lime-600',
    ring: 'ring-lime-300',
    dividerColor: '#65a30d',
  },
};

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

const ALL_DEPARTMENTS = Object.values(FACULTY_DEPARTMENTS).flat().sort();

const ALL_FACULTIES = Object.keys(FACULTY_CONFIG);

function normalizeFaculty(fac) {
  if (!fac) return 'Engineering';
  const clean = String(fac).trim();
  if (clean.includes('Engineering')) return 'Engineering';
  if (clean.includes('Life Science')) return 'Life Science';
  if (clean.includes('Social Science')) return 'Social Science';
  if (clean.includes('Business')) return 'Business Studies';
  if (clean.includes('Humanities') || clean.includes('Arts')) return 'Humanities';
  if (clean.includes('Science') && !clean.includes('Life') && !clean.includes('Social')) return 'Science';
  if (clean.includes('Law')) return 'Law';
  if (clean.includes('Animal') || clean.includes('Veterinary') || clean.includes('ASVM')) return 'Animal Science and Veterinary Medicine';
  if (clean.includes('Agriculture') || clean.includes('Agri')) return 'Agriculture';
  return clean;
}

function normalizeDepartment(dept) {
  if (!dept) return 'CSE';
  const d = String(dept).trim();
  const lower = d.toLowerCase();
  
  if (lower === 'cse' || lower.includes('computer science')) return 'CSE';
  if (lower === 'eee' || lower.includes('electrical and electronic')) return 'EEE';
  if (lower === 'ete' || lower.includes('electronics and telecommunication')) return 'ETE';
  if (lower === 'acce' || lower.includes('applied chemistry')) return 'ACCE';
  if (lower === 'ce' || lower.includes('civil engineering')) return 'CE';
  if (lower === 'fe' || lower === 'fape' || lower.includes('food')) return 'Food and Agroprocess Engineering';
  if (lower === 'arch' || lower.includes('architecture')) return 'ARCH';
  
  if (lower.includes('math')) return 'Mathematics';
  if (lower.includes('stat')) return 'Statistics';
  if (lower.includes('chem') && !lower.includes('applied')) return 'Chemistry';
  if (lower.includes('phy')) return 'Physics';
  if (lower === 'esdm' || lower.includes('environmental')) return 'ESDM';
  
  if (lower.includes('pharm')) return 'Pharmacy';
  if (lower === 'bge' || lower.includes('biotechnology')) return 'BGE';
  if (lower === 'bmb' || lower.includes('biochemistry')) return 'BMB';
  if (lower.includes('botany') || lower === 'bot') return 'Botany';
  
  if (lower.includes('english') || lower === 'eng') return 'English';
  if (lower.includes('bangla') || lower.includes('bengali') || lower === 'ban') return 'Bangla';
  if (lower.includes('history') || lower === 'his') return 'History';
  
  if (lower.includes('psychology') || lower === 'psy') return 'Psychology';
  if (lower.includes('sociology') || lower === 'soc') return 'Sociology';
  if (lower === 'pad' || lower.includes('public administration')) return 'PAD';
  if (lower === 'ir' || lower.includes('international relations')) return 'IR';
  if (lower.includes('econ') || lower === 'eco') return 'Economics';
  if (lower === 'ps' || lower.includes('political science')) return 'PS';
  
  if (lower.includes('management') || lower === 'mgt') return 'Management Studies';
  if (lower === 'ais' || lower.includes('accounting')) return 'AIS';
  if (lower.includes('marketing') || lower === 'mkt') return 'Marketing';
  if (lower.includes('finance') || lower === 'fb') return 'Finance and Banking';
  if (lower === 'thm' || lower.includes('tourism')) return 'THM';
  
  if (lower.includes('law') || lower === 'llb') return 'Law';
  if (lower === 'asvm' || lower.includes('animal science')) return 'ASVM';
  if (lower.includes('agri')) return 'Agriculture';
  if (lower === 'fmb' || lower.includes('fisheries')) return 'FMB';

  return d;
}

const Homepage = () => {
  const navigate = useNavigate();
  const [routinesList, setRoutinesList] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFaculty, setSelectedFaculty] = useState('All');
  const [selectedDepartment, setSelectedDepartment] = useState('All');
  const { user } = useAuth();

  const fetchList = () => {
    setLoadingList(true);
    classRoutineApi.list()
      .then(res => setRoutinesList(res.data.data || []))
      .catch(() => toast.error('Failed to load class routines.'))
      .finally(() => setLoadingList(false));
  };

  useEffect(() => { fetchList(); }, []);

  const normalizedRoutines = useMemo(() => {
    return routinesList.map(item => ({
      ...item,
      faculty: normalizeFaculty(item.faculty),
      department: normalizeDepartment(item.department)
    }));
  }, [routinesList]);

  const handleDeptClick = (item) => {
    navigate(`/routines/${item.id}`);
  };

  const handleDelete = async (e, id, dept) => {
    e.stopPropagation();
    if (!window.confirm(`Remove routine for "${dept}" from Class Routines?`)) return;
    try {
      await classRoutineApi.delete(id);
      toast.success(`Removed ${dept}`);
      fetchList();
    } catch { toast.error('Failed to remove.'); }
  };

  // List of departments for filter dropdown: ALL_DEPARTMENTS if All Faculties, else only matching departments for selectedFaculty
  const availableDepartments = useMemo(() => {
    if (selectedFaculty === 'All') {
      return ALL_DEPARTMENTS;
    }
    return FACULTY_DEPARTMENTS[selectedFaculty] || [];
  }, [selectedFaculty]);

  // Handle active filters
  const filtered = useMemo(() => {
    return normalizedRoutines.filter(item => {
      // Faculty filter
      if (selectedFaculty !== 'All' && item.faculty !== selectedFaculty) {
        return false;
      }
      // Department filter
      if (selectedDepartment !== 'All' && item.department !== selectedDepartment) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          item.department.toLowerCase().includes(q) ||
          item.faculty.toLowerCase().includes(q) ||
          item.year.includes(q) ||
          item.term.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [normalizedRoutines, selectedFaculty, selectedDepartment, searchQuery]);

  // Group filtered results by faculty
  const grouped = useMemo(() => {
    return filtered.reduce((acc, item) => {
      const f = item.faculty;
      if (!acc[f]) acc[f] = [];
      acc[f].push(item);
      return acc;
    }, {});
  }, [filtered]);

  const isFilterActive = selectedFaculty !== 'All' || selectedDepartment !== 'All' || searchQuery.trim() !== '';

  return (
    <div className="page-enter max-w-7xl mx-auto space-y-8 pb-16">

      {/* ── COMPACT HERO ─────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl bg-ocean-950 border border-white/[0.07] shadow-xl">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute right-0 top-0 w-72 h-full bg-gradient-to-l from-indigo-600/15 to-transparent" />
          <div className="absolute left-0 bottom-0 w-64 h-24 bg-gradient-to-tr from-sky-600/10 to-transparent" />
        </div>

        <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 px-4 sm:px-6 py-4 sm:py-6">
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <div className="shrink-0 w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br from-sky-400 to-indigo-600 flex items-center justify-center shadow-lg">
              <Waves className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                <h1 className="text-lg sm:text-2xl font-bold text-white tracking-tight">Class Routines</h1>
                <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest text-sky-400 bg-sky-400/10 border border-sky-400/20 px-2 py-0.5 rounded-full">
                  Official
                </span>
              </div>
              <p className="text-slate-400 text-[11px] sm:text-xs mt-0.5 sm:mt-1">
                Browse weekly timetables by faculty and department
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3.5 py-1.5 sm:py-2 self-start sm:self-auto shrink-0">
            <GraduationCap className="w-4 h-4 sm:w-5 sm:h-5 text-sky-400 shrink-0" />
            <div>
              <p className="text-sm sm:text-base font-bold text-white leading-none">{routinesList.length}</p>
              <p className="text-[8px] sm:text-[9px] uppercase tracking-widest text-slate-400 leading-none mt-1 font-bold">Saved Routines</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── PREMIUM FILTER & SEARCH BAR ─────────────────────────── */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-3.5 sm:p-5 shadow-xs space-y-2.5 md:space-y-0 md:flex md:items-center md:gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder="Search by year, term or keyword..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 sm:py-2 text-sm sm:text-xs font-semibold bg-slate-50 hover:bg-slate-100/50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-sky-500 focus:ring-2 focus:ring-sky-100 transition-all min-h-[42px] sm:min-h-0"
          />
        </div>

        {/* Faculty Select */}
        <div className="relative w-full md:w-auto md:min-w-[200px]">
          <Layers className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <select
            value={selectedFaculty}
            onChange={e => {
              setSelectedFaculty(e.target.value);
              setSelectedDepartment('All');
            }}
            className="w-full pl-9 pr-8 py-2.5 sm:py-2 text-sm sm:text-xs font-semibold bg-slate-50 hover:bg-slate-100/50 border border-slate-200 rounded-xl text-slate-700 appearance-none focus:outline-none focus:bg-white focus:border-sky-500 focus:ring-2 focus:ring-sky-100 transition-all cursor-pointer min-h-[42px] sm:min-h-0"
          >
            <option value="All">All Faculties (সব অনুষদ)</option>
            {ALL_FACULTIES.map(fac => (
              <option key={fac} value={fac}>{fac}</option>
            ))}
          </select>
          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-slate-400 w-0 h-0" />
        </div>

        {/* Department Select */}
        <div className="relative w-full md:w-auto md:min-w-[200px]">
          <LayoutGrid className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <select
            value={selectedDepartment}
            onChange={e => setSelectedDepartment(e.target.value)}
            className="w-full pl-9 pr-8 py-2.5 sm:py-2 text-sm sm:text-xs font-semibold bg-slate-50 hover:bg-slate-100/50 border border-slate-200 rounded-xl text-slate-700 appearance-none focus:outline-none focus:bg-white focus:border-sky-500 focus:ring-2 focus:ring-sky-100 transition-all cursor-pointer min-h-[42px] sm:min-h-0"
          >
            <option value="All">All Departments (সব বিভাগ)</option>
            {availableDepartments.map(dept => (
              <option key={dept} value={dept}>{dept}</option>
            ))}
          </select>
          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-slate-400 w-0 h-0" />
        </div>

        {/* Reset Button */}
        {isFilterActive && (
          <button
            onClick={() => {
              setSearchQuery('');
              setSelectedFaculty('All');
              setSelectedDepartment('All');
            }}
            className="w-full md:w-auto px-4 py-2.5 sm:py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all min-h-[42px] sm:min-h-0 active:bg-slate-300"
          >
            Reset Filters
          </button>
        )}
      </div>

      {/* ── LOADING ── */}
      {loadingList && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
        </div>
      )}

      {/* ── NO RESULTS BANNER ── */}
      {!loadingList && filtered.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 sm:p-16 text-center shadow-xs">
          <Filter className="w-10 h-10 sm:w-12 sm:h-12 mx-auto text-slate-300 mb-3" />
          <h3 className="text-sm sm:text-base font-bold text-slate-700">কোনো রুটিন খুঁজে পাওয়া যায়নি (No routines found)</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            আপনার সিলেক্ট করা ফিল্টারের সাথে মিলে যায় এমন কোনো ক্লাস রুটিন পাওয়া যায়নি। ফিল্টার রিসেট করে আবার চেষ্টা করুন।
          </p>
          <button
            onClick={() => {
              setSearchQuery('');
              setSelectedFaculty('All');
              setSelectedDepartment('All');
            }}
            className="mt-4 px-4 py-2.5 bg-sky-600 hover:bg-sky-700 active:bg-sky-800 text-white font-bold text-xs rounded-xl shadow-xs transition-all"
          >
            ফিল্টার রিসেট করুন (Reset Filters)
          </button>
        </div>
      )}

      {/* ── FACULTY SECTIONS ── */}
      {!loadingList && filtered.length > 0 && (
        <div className="space-y-10">
          {ALL_FACULTIES.map(facultyName => {
            const fc = FACULTY_CONFIG[facultyName];
            const Icon = fc.icon;
            const depts = grouped[facultyName] || [];

            // If filtering is active, skip rendering empty sections entirely
            if (isFilterActive && depts.length === 0) return null;
            // If showing default view (no filter active), skip sections that have no saved routines
            if (!isFilterActive && depts.length === 0) return null;

            return (
              <section key={facultyName} className="animate-in fade-in-50 duration-200">
                <div className="flex items-center gap-3 mb-4">
                  <div className={`w-8 h-8 rounded-xl bg-gradient-to-br ${fc.gradient} flex items-center justify-center shadow-md shrink-0`}>
                    <Icon className="w-4 h-4 text-white" />
                  </div>
                  <div className="flex items-baseline gap-2 min-w-0">
                    <h2 className="text-base font-bold text-slate-800 truncate">
                      Faculty of {facultyName}
                    </h2>
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${fc.chip} shrink-0`}>
                      {depts.length} dept{depts.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="flex-1 h-px bg-slate-100 hidden sm:block" />
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2.5 sm:gap-3">
                  {depts.map(item => (
                    <div
                      key={item.id}
                      id={`dept-${item.id}`}
                      onClick={() => handleDeptClick(item)}
                      className="group relative text-left rounded-xl border border-slate-200/90 bg-white hover:border-sky-400 hover:shadow-md hover:-translate-y-0.5 overflow-hidden transition-all duration-200 cursor-pointer shadow-xs flex flex-col justify-between"
                    >
                      <div className={`h-1 w-full bg-gradient-to-r ${fc.gradient}`} />

                      <div className="p-3 sm:p-3.5 space-y-2">
                        <div className="flex items-center justify-between gap-1">
                          <div className="w-7 h-7 rounded-lg bg-slate-100 group-hover:bg-sky-50 text-slate-500 group-hover:text-sky-600 flex items-center justify-center transition-colors">
                            <Icon className="w-3.5 h-3.5" />
                          </div>
                          {user && (
                            <button
                              type="button"
                              onClick={e => handleDelete(e, item.id, item.department)}
                              className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-slate-300 hover:text-red-500 hover:bg-red-50 transition-all"
                              title="Remove"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>

                        <div>
                          <h3 className="text-base sm:text-lg font-bold leading-tight tracking-tight text-slate-800 group-hover:text-sky-600 transition-colors truncate">
                            {item.department}
                          </h3>
                        </div>

                        <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                          <div className="flex items-center gap-1 min-w-0">
                            <Calendar className="w-3 h-3 text-slate-400 shrink-0" />
                            <span className="text-[10px] font-semibold text-slate-500 truncate">{item.year} · {item.term}</span>
                          </div>
                          <ArrowRight className="w-3 h-3 text-slate-300 group-hover:translate-x-0.5 group-hover:text-sky-500 transition-all shrink-0" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Homepage;

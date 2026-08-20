import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import RoutineGrid from '../components/RoutineGrid';
import RoutineFilterBar from '../components/RoutineFilterBar';
import CourseDetailModal from '../components/CourseDetailModal';
import { classRoutineApi } from '../api/client';
import {
  ArrowLeft, Download, Loader2, FileText, Calendar, Clock,
  GraduationCap, Cpu, Atom, Leaf, BookOpen, Users, Briefcase, Scale, Stethoscope, Sprout
} from 'lucide-react';
import toast from 'react-hot-toast';
import domtoimage from 'dom-to-image-more';
import { jsPDF } from 'jspdf';

const FACULTY_CONFIG = {
  Engineering: { icon: Cpu, gradient: 'from-indigo-500 to-violet-600', chip: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  Science: { icon: Atom, gradient: 'from-cyan-500 to-sky-600', chip: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  'Life Science': { icon: Leaf, gradient: 'from-emerald-500 to-teal-600', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  Humanities: { icon: BookOpen, gradient: 'from-amber-500 to-orange-600', chip: 'bg-amber-50 text-amber-700 border-amber-200' },
  'Social Science': { icon: Users, gradient: 'from-purple-500 to-fuchsia-600', chip: 'bg-purple-50 text-purple-700 border-purple-200' },
  'Business Studies': { icon: Briefcase, gradient: 'from-rose-500 to-pink-600', chip: 'bg-rose-50 text-rose-700 border-rose-200' },
  Law: { icon: Scale, gradient: 'from-slate-600 to-gray-800', chip: 'bg-slate-100 text-slate-700 border-slate-300' },
  'Animal Science and Veterinary Medicine': { icon: Stethoscope, gradient: 'from-teal-500 to-emerald-700', chip: 'bg-teal-50 text-teal-700 border-teal-200' },
  Agriculture: { icon: Sprout, gradient: 'from-lime-600 to-green-700', chip: 'bg-lime-50 text-lime-800 border-lime-200' },
};

const PublicRoutineViewPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  const [routineDetail, setRoutineDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [routineFilters, setRoutineFilters] = useState({
    teacher: '',
    day: '',
    time: '',
    course: '',
  });
  const [selectedCell, setSelectedCell] = useState(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setErrorMsg(null);
    classRoutineApi.getDetail(id)
      .then((res) => {
        setRoutineDetail(res.data.data);
      })
      .catch((err) => {
        const msg = err.message || 'Failed to load routine.';
        setErrorMsg(msg);
        toast.error(msg);
      })
      .finally(() => setLoading(false));
  }, [id]);

  const meta = routineDetail?.meta || {};
  const cfg = meta.faculty ? FACULTY_CONFIG[meta.faculty] : null;
  const FacultyIcon = cfg?.icon || GraduationCap;

  const downloadPDF = async () => {
    const toastId = toast.loading('Generating PDF (this might take a few seconds)...');
    setDownloadingPdf(true);
    try {
      // Target the unscaled pure routine table element
      const element = document.getElementById('routine-capture-target') || document.getElementById('routine-pdf-container');
      if (!element) throw new Error("Could not find the routine container.");

      // Clone the element offscreen to capture it at 100% full scale with zero scrollbars
      const clone = element.cloneNode(true);
      clone.style.transform = 'none';
      clone.style.width = 'max-content';
      clone.style.minWidth = '960px';
      clone.style.maxWidth = 'none';
      clone.style.height = 'auto';
      clone.style.overflow = 'visible';
      clone.style.position = 'fixed';
      clone.style.top = '-99999px';
      clone.style.left = '-99999px';
      clone.style.zIndex = '-9999';
      clone.style.background = '#ffffff';

      // Ensure zero scrollbars or overflow clipping on all children
      clone.querySelectorAll('*').forEach((el) => {
        el.style.overflow = 'visible';
      });

      document.body.appendChild(clone);
      await new Promise((r) => setTimeout(r, 100));

      const captureWidth = clone.scrollWidth || 1000;
      const captureHeight = clone.scrollHeight || 600;

      const scale = 2; // HD scale factor
      const style = {
        transform: `scale(${scale})`,
        transformOrigin: 'top left',
        width: captureWidth + 'px',
        height: captureHeight + 'px',
        overflow: 'visible',
      };

      let imgData;
      try {
        imgData = await domtoimage.toJpeg(clone, {
          width: captureWidth * scale,
          height: captureHeight * scale,
          quality: 0.98,
          bgcolor: '#ffffff',
          filter: (node) => {
            if (node.getAttribute && node.getAttribute('data-pdf-exclude') === 'true') return false;
            if (node.classList && node.classList.contains('routine-zoom-toolbar')) return false;
            return true;
          },
          style,
        });
      } finally {
        if (clone && clone.parentNode) {
          clone.parentNode.removeChild(clone);
        }
      }

      const img = new Image();
      img.src = imgData;
      await new Promise((r) => { img.onload = r; });

      const pdfWidth = 1008;  // Legal landscape width in points (14 inches)
      const pdfHeight = 612;  // Legal landscape height in points (8.5 inches)
      const margin = 36;      // 0.5 inch margin in points
      const maxWidth = pdfWidth - margin * 2;
      const maxHeight = pdfHeight - margin * 2;

      let printWidth = img.width;
      let printHeight = img.height;
      const ratio = printWidth / printHeight;
      const maxRatio = maxWidth / maxHeight;

      if (ratio > maxRatio) {
        printWidth = maxWidth;
        printHeight = maxWidth / ratio;
      } else {
        printHeight = maxHeight;
        printWidth = maxHeight * ratio;
      }

      const x = (pdfWidth - printWidth) / 2;
      const y = (pdfHeight - printHeight) / 2;

      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'pt',
        format: 'legal',
      });

      pdf.addImage(imgData, 'JPEG', x, y, printWidth, printHeight);
      pdf.save(`${meta.department || 'Department'}_${meta.year || '2026'}_${meta.term || 'Routine'}.pdf`);

      toast.success('PDF downloaded successfully!', { id: toastId });
    } catch (err) {
      console.error('PDF Generation Error:', err);
      toast.error(`Error: ${err.message || 'Failed to generate PDF.'}`, { id: toastId, duration: 6000 });
    } finally {
      setDownloadingPdf(false);
    }
  };

  const filteredAssignments = useMemo(() => {
    if (!routineDetail?.assignments) return [];
    return routineDetail.assignments.filter((a) => {
      if (routineFilters.teacher && a.teacher_abbr !== routineFilters.teacher) return false;
      if (routineFilters.day && a.day !== routineFilters.day) return false;
      if (routineFilters.time && String(a.slot_start) !== routineFilters.time) return false;
      if (routineFilters.course && a.course_code !== routineFilters.course) return false;
      return true;
    });
  }, [routineDetail, routineFilters]);

  const header = useMemo(() => {
    if (!routineDetail) return {};
    const c = routineDetail.config || {};
    return {
      university: c.university || c.university_name || 'University Name',
      department: c.department || meta.department || c.department_name || 'Department',
      semester: c.semester || meta.term || c.semester_name || '',
      year: c.year || meta.year || '',
    };
  }, [routineDetail, meta]);

  return (
    <div className="page-enter max-w-7xl mx-auto space-y-6 pb-16">
      {loading && (
        <div className="card py-24 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-sky-500 mx-auto mb-2" />
          <p className="text-xs font-semibold text-slate-500">Loading department class routine…</p>
        </div>
      )}

      {!loading && !routineDetail && (
        <div className="card p-12 text-center">
          <FileText className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-slate-800">
            {errorMsg ? 'Routine Unavailable' : 'Routine Not Found'}
          </h2>
          <p className="text-xs text-slate-500 mt-1 mb-4 max-w-md mx-auto">
            {errorMsg || 'The class routine you requested may have been removed or does not exist.'}
          </p>
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-4 py-2 bg-sky-500 text-white font-semibold text-xs rounded-xl hover:bg-sky-400 transition-colors"
          >
            Return to Homepage
          </Link>
        </div>
      )}

      {!loading && routineDetail && (
        <div className="space-y-6">
          {/* Header card matching RoutinePage */}
          <div className="bg-linear-to-br from-ocean-900 to-ocean-800 rounded-2xl px-4 sm:px-6 py-4 sm:py-5 text-white border border-sky-500/15 shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start sm:items-center gap-3">
              <button
                onClick={() => navigate('/')}
                className="bg-white/10 hover:bg-white/20 p-2 rounded-lg transition-colors shrink-0 mt-0.5 sm:mt-0 cursor-pointer"
                title="Back to Class Routines"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <Calendar className="w-4 h-4 text-sky-400 shrink-0" />
                  <span className="text-xs font-semibold tracking-widest uppercase text-sky-400">
                    Faculty of {meta.faculty || 'Engineering'}
                  </span>
                  <span className="inline-flex items-center text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-400/30">
                    Published Routine
                  </span>
                </div>
                <h1 className="text-lg sm:text-xl font-bold truncate">
                  Department of {meta.department || 'CSE'}
                </h1>
                <p className="text-sky-300 text-xs sm:text-sm truncate">
                  Academic Year {meta.year || '2026'} · {meta.term || 'Fall'} Term
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 w-full md:w-auto">
              <button
                onClick={downloadPDF}
                disabled={downloadingPdf}
                className="w-full sm:w-auto bg-white/10 hover:bg-white/20 active:bg-white/30 text-white px-4 py-2.5 sm:py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer min-h-[42px] sm:min-h-0 shadow-xs"
              >
                {downloadingPdf ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                Download PDF
              </button>
            </div>
          </div>

          {/* Counts strip matching RoutinePage */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white border border-slate-200/80 rounded-xl p-3.5 shadow-2xs">
              <span className="text-xs text-slate-500 font-medium">Teachers</span>
              <p className="text-lg font-bold text-slate-800 mt-0.5">{routineDetail.teachers?.length || 0}</p>
            </div>
            <div className="bg-white border border-slate-200/80 rounded-xl p-3.5 shadow-2xs">
              <span className="text-xs text-slate-500 font-medium">Courses</span>
              <p className="text-lg font-bold text-slate-800 mt-0.5">{routineDetail.courses?.length || 0}</p>
            </div>
            <div className="bg-white border border-slate-200/80 rounded-xl p-3.5 shadow-2xs">
              <span className="text-xs text-slate-500 font-medium">Rooms</span>
              <p className="text-lg font-bold text-slate-800 mt-0.5">{routineDetail.rooms?.length || 0}</p>
            </div>
            <div className="bg-sky-500 text-white rounded-xl p-3.5 shadow-sm">
              <span className="text-xs text-sky-100 font-medium">Classes placed</span>
              <p className="text-lg font-bold mt-0.5">{routineDetail.assignments?.length || 0}</p>
            </div>
          </div>

          {/* Filter Bar */}
          <RoutineFilterBar
            assignments={routineDetail.assignments || []}
            teachers={routineDetail.teachers || []}
            filters={routineFilters}
            onFilter={setRoutineFilters}
          />

          {/* Routine Grid Container */}
          <div id="routine-pdf-container">
            <RoutineGrid
              assignments={filteredAssignments}
              header={header}
              teachers={routineDetail.teachers || []}
              config={routineDetail.config || {}}
              yearSemList={routineDetail.yearSemList || []}
              dayList={routineDetail.dayList || []}
              onCellClick={setSelectedCell}
            />
          </div>
        </div>
      )}

      {selectedCell && routineDetail && (
        <CourseDetailModal
          entry={selectedCell}
          teachers={routineDetail.teachers || []}
          onClose={() => setSelectedCell(null)}
        />
      )}
    </div>
  );
};

export default PublicRoutineViewPage;

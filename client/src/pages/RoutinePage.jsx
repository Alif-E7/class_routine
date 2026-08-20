import { useCallback, useEffect, useState, useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Calendar,
  Loader2,
  Play,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  FileText,
  FileDown,
  FileSpreadsheet,
  MessageSquareText,
  ChevronDown,
  ChevronUp,
  Send,
  BookmarkPlus,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { batchesApi, routineApi, exportApi, editApi, explainApi } from '../api/client';
import RoutineGrid from '../components/RoutineGrid';
import FloatingAiChat from '../components/FloatingAiChat';
import CourseDetailModal from '../components/CourseDetailModal';
import RoutineFilterBar from '../components/RoutineFilterBar';
import AddToClassRoutineModal from '../components/AddToClassRoutineModal';
import domtoimage from 'dom-to-image-more';
import { jsPDF } from 'jspdf';

/**
 * RoutinePage — view / re-generate the routine for one upload batch.
 *
 * Loads:
 *   - GET /api/batches/:id           (batch meta + counts)
 *   - GET /api/batches/:id/schedule  (assignments)
 *
 * Allows:
 *   - Generate / Re-generate (POST /api/batches/:id/generate)
 *   - Friendly-hint display when scheduler reports infeasibility
 */
const RoutinePage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const batchId = Number.parseInt(id, 10);

  const [batch, setBatch] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [config, setConfig] = useState(null);
  const [score, setScore] = useState(null);
  const [teachers, setTeachers] = useState([]);
  const [showAddToClassRoutineModal, setShowAddToClassRoutineModal] = useState(false);  const [header, setHeader] = useState({
    university: 'University Name',
    department: 'Department',
    semester: '',
    year: '',
  });

  const [yearSemList, setYearSemList] = useState([]);
  const [dayList, setDayList] = useState([]);

  // Filter state
  const [routineFilters, setRoutineFilters] = useState({ teacher: '', day: '', time: '', course: '' });

  // Course detail modal state
  const [selectedCell, setSelectedCell] = useState(null);

  // Filtered assignments derived from raw assignments + filters
  const filteredAssignments = useMemo(() => {
    if (!routineFilters.teacher && !routineFilters.day && !routineFilters.time && !routineFilters.course) {
      return assignments;
    }
    return assignments.filter((a) => {
      if (routineFilters.teacher && a.teacher_abbr !== routineFilters.teacher) return false;
      if (routineFilters.day && a.day !== routineFilters.day) return false;
      if (routineFilters.time && String(a.slot_start) !== String(routineFilters.time)) return false;
      if (routineFilters.course && a.course_code !== routineFilters.course) return false;
      return true;
    });
  }, [assignments, routineFilters]);

  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [friendlyHint, setFriendlyHint] = useState(null);

  const loadRoutine = useCallback(async () => {
    setLoading(true);
    setError(null);
    setFriendlyHint(null);
    try {
      const detailRes = await batchesApi.detail(batchId);
      const b = detailRes.data.batch;
      setBatch(b);

      try {
        const scheduleRes = await routineApi.getRoutine(batchId);
        const configData = scheduleRes.data.config || null;
        setHeader({
          university: configData?.university || 'University Name',
          department: configData?.department || 'Department',
          semester: configData?.semester || b?.semester || '',
          year: configData?.year || b?.year || '',
        });
        setAssignments(scheduleRes.data.assignments || []);
        setConfig(configData);
        setYearSemList(scheduleRes.data.year_sem_list || []);
        setDayList(scheduleRes.data.day_list || []);
        setScore(scheduleRes.data.score !== undefined ? scheduleRes.data.score : null);
      } catch (schedErr) {
        // If schedule is not yet generated or batch is in review, keep batch header & errors accessible
        setAssignments([]);
        if (schedErr.code === 'BATCH_NOT_READY') {
          setFriendlyHint(schedErr.message || 'This batch is currently under review.');
        }
      }
    } catch (err) {
      const status = err.response?.status;
      if (status === 404) {
        setError('Batch not found. It may have been deleted.');
      } else {
        setError(err.message || 'Failed to load routine.');
      }
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  useEffect(() => {
    if (!Number.isInteger(batchId) || batchId <= 0) {
      setError('Invalid batch id in URL.');
      setLoading(false);
      return;
    }
    loadRoutine();
  }, [batchId, loadRoutine]);

  // Load teachers for the legend
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await batchesApi.getTeachers(batchId);
        if (cancelled) return;
        setTeachers(res.data.teachers || []);
      } catch (_e) {
        if (!cancelled) setTeachers([]);
      }
    })();
    return () => { cancelled = true; };
  }, [batchId]);

  const handleGenerate = async () => {
    setGenerating(true);
    setFriendlyHint(null);
    const tid = toast.loading('Solving… this can take a few seconds.');
    try {
      const res = await routineApi.generateRoutine(batchId);
      const data = res.data;
      toast.success(
        `Routine generated: ${data.assignments_count} classes placed.`,
        { id: tid }
      );
      // Re-fetch schedule + batch detail (counts updated).
      await loadRoutine();
    } catch (err) {
      const code = err.code;
      const isInfeasible = code === 'SCHEDULE_INFEASIBLE' || code === 'SCHEDULE_BUDGET_EXCEEDED';
      if (isInfeasible) {
        const unplaceable = err.unplaceable || [];
        const summary =
          unplaceable.length > 0
            ? `Infeasible: ${unplaceable.length} course(s) unplaceable — ${unplaceable.slice(0, 3).join(', ')}${unplaceable.length > 3 ? '…' : ''}`
            : err.message || 'Infeasible schedule.';
        toast.error(summary, { id: tid, duration: 7000 });
        setFriendlyHint(err.friendly_hint || null);
      } else {
        toast.error(err.message || 'Failed to generate routine.', { id: tid });
      }
    } finally {
      setGenerating(false);
    }
  };

  const [downloading, setDownloading] = useState(null); // 'docx' | 'pdf' | null



  const handleDownload = async () => {
    if (!hasSchedule) {
      toast.error('Generate the routine first.');
      return;
    }

    setDownloading('pdf');
    const tid = toast.loading('Generating PDF (this might take a few seconds)...');

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

      const pdfWidth = 1008;  // Legal height/width in points (14 inches)
      const pdfHeight = 612;  // Legal height/width in points (8.5 inches)
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
        format: 'legal'
      });

      pdf.addImage(imgData, 'JPEG', x, y, printWidth, printHeight);
      pdf.save(`${batch?.filename || 'routine'}.pdf`);

      toast.success('Downloaded PDF successfully!', { id: tid });
    } catch (err) {
      console.error('PDF Generation Error:', err);
      toast.error(`Error: ${err.message || 'Failed to generate PDF.'}`, { id: tid, duration: 6000 });
    } finally {
      setDownloading(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-ocean-600">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-3xl mx-auto bg-white border border-red-200 rounded-xl p-8 text-center">
        <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-3" />
        <p className="text-red-700 font-semibold">{error}</p>
        <button
          onClick={() => navigate('/history')}
          className="mt-4 inline-flex items-center gap-2 text-ocean-700 hover:text-ocean-900"
        >
          <ArrowLeft className="w-4 h-4" /> Back to history
        </button>
      </div>
    );
  }

  const hasSchedule = assignments.length > 0;

  const handleAssignmentMove = async (draggedEntry, target) => {
    const updatedAssignments = assignments.map(a => {
      if (
        a.course_code === draggedEntry.course_code &&
        a.year_sem === draggedEntry.year_sem &&
        a.day === draggedEntry.day &&
        a.slot_start === draggedEntry.slot_start
      ) {
        return {
          ...a,
          day: target.day,
          year_sem: target.ys || target.yearSem,
          slot_start: target.slotStart,
          slot_end: target.slotEnd,
        };
      }
      return a;
    });

    setAssignments(updatedAssignments);

    try {
      await routineApi.updateSchedule(batchId, updatedAssignments);
      toast.success(`Successfully moved ${draggedEntry.course_code} to ${target.day}`);
    } catch (err) {
      toast.error('Failed to save schedule move to backend.');
      loadRoutine();
    }
  };

  return (
    <div className="max-w-[1400px] mx-auto space-y-6">
      {/* Header card */}
      <div className="print:hidden bg-linear-to-br from-ocean-900 to-ocean-800 rounded-2xl px-4 sm:px-6 py-4 sm:py-5 text-white border border-sky-500/15 shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3">
          <button
            onClick={() => navigate('/history')}
            className="bg-white/10 hover:bg-white/20 p-2 rounded-lg transition-colors shrink-0 mt-0.5 sm:mt-0"
            title="Back to history"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <Calendar className="w-4 h-4 text-sky-400 shrink-0" />
              <span className="text-xs font-semibold tracking-widest uppercase text-sky-400">
                Batch #{batchId}
              </span>
              <StatusBadge status={batch?.status} hasSchedule={hasSchedule} />
            </div>
            <h1 className="text-lg sm:text-xl font-bold truncate">
              {batch?.department ? `${batch.department} Routine` : (batch?.filename || 'Routine')}
            </h1>
            <p className="text-sky-300 text-xs sm:text-sm truncate">
              {batch?.semester || 'Academic Routine'} · Imported{' '}
              {batch?.created_at
                ? new Date(batch.created_at).toLocaleString()
                : '—'}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:flex sm:flex-wrap items-center gap-2 sm:gap-3 w-full md:w-auto">
          <button
            onClick={handleDownload}
            disabled={!hasSchedule || downloading != null || generating}
            className="w-full sm:w-auto bg-white/10 hover:bg-white/20 active:bg-white/30 text-white px-3 sm:px-3.5 py-2.5 sm:py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed min-h-[42px] sm:min-h-0"
            title={hasSchedule ? 'Download as .pdf' : 'Generate the routine first'}
          >
            {downloading === 'pdf' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <FileDown className="w-4 h-4" />
            )}
            Download PDF
          </button>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="w-full sm:w-auto bg-sky-500 hover:bg-sky-400 active:bg-sky-600 text-white px-4 py-2.5 sm:py-2 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 min-h-[42px] sm:min-h-0 shadow-md"
          >
            {generating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Generating…
              </>
            ) : hasSchedule ? (
              <>
                <Play className="w-4 h-4" /> Re-generate
              </>
            ) : (
              <>
                <Play className="w-4 h-4" /> Generate Routine
              </>
            )}
          </button>
        </div>
      </div>

      {/* Counts strip */}
      {batch?.counts && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
          <CountChip label="Teachers" value={batch.counts.teachers} />
          <CountChip label="Courses" value={batch.counts.courses} />
          <CountChip label="Rooms" value={batch.counts.rooms} />
          <CountChip
            label="Classes placed"
            value={batch.counts.assignments}
            highlight={hasSchedule}
          />
        </div>
      )}

      {/* AI hint banner */}
      {friendlyHint && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3">
          <Sparkles className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
          <div className="text-sm text-amber-900">
            <div className="font-semibold mb-1">AI suggestion</div>
            <p className="leading-relaxed whitespace-pre-wrap">{friendlyHint}</p>
          </div>
        </div>
      )}

      {/* Validation errors + warnings from upload step (if any) */}
      {batch?.error_log && (
        <ValidationErrorPanel
          errorLog={batch.error_log}
          batchId={batchId}
        />
      )}

      {/* Filter bar — only shown when schedule exists */}
      {hasSchedule && (
        <RoutineFilterBar
          assignments={assignments}
          teachers={teachers}
          filters={routineFilters}
          onFilter={setRoutineFilters}
        />
      )}

      {/* ── Add to Class Routine — between filter bar and grid ── */}
      {hasSchedule && (
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-gradient-to-r from-sky-50 to-indigo-50 border border-sky-200/60 rounded-2xl p-3.5 sm:px-4 sm:py-3 shadow-xs">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-sky-400 to-indigo-600 flex items-center justify-center shadow-sm shrink-0">
              <BookmarkPlus className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-xs sm:text-sm font-bold text-slate-800 leading-tight">Publish to Class Routines</p>
              <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5">Make this routine available on the public Class Routines homepage</p>
            </div>
          </div>
          <button
            onClick={() => setShowAddToClassRoutineModal(true)}
            disabled={generating}
            className="w-full sm:w-auto shrink-0 flex items-center justify-center gap-1.5 px-4 py-2.5 sm:py-2 bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 active:from-sky-600 active:to-indigo-700 text-white text-xs font-bold rounded-xl shadow-md transition-all disabled:opacity-50 min-h-[42px] sm:min-h-0"
          >
            <BookmarkPlus className="w-3.5 h-3.5" />
            Add to Class Routine
          </button>
        </div>
      )}

      {/* Routine grid */}
      <div id="routine-pdf-container">
        <RoutineGrid
          assignments={filteredAssignments}
          header={header}
          teachers={teachers}
          config={config}
          yearSemList={yearSemList}
          dayList={dayList}
          onCellClick={setSelectedCell}
          onAssignmentMove={handleAssignmentMove}
        />
      </div>

      {!hasSchedule && (
        <div className="bg-white border border-dashed border-ocean-200 rounded-xl p-8 text-center">
          <FileSpreadsheet className="w-10 h-10 mx-auto text-ocean-300 mb-2" />
          <p className="text-slate-500">
            No schedule generated yet for this batch.
          </p>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="mt-3 inline-flex items-center gap-2 bg-sky-500 hover:bg-sky-400 text-white px-4 py-2 rounded-lg font-medium disabled:opacity-50"
          >
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Generate Routine
          </button>
        </div>
      )}


      {hasSchedule && (
        <div className="mt-8 space-y-4">
          <div className="flex items-center justify-center space-x-2">
            <Sparkles className="w-6 h-6 text-yellow-500" />
            <h3 className="text-xl font-bold text-slate-800">Routine Quality Score: {score !== null ? `${score}/10` : 'N/A'}</h3>
          </div>
        </div>
      )}

      {/* Floating AI Chat Widget */}
      <FloatingAiChat batchId={batchId} score={score} hasSchedule={hasSchedule} />

      {/* Course Detail Modal */}
      {selectedCell && (
        <CourseDetailModal
          entry={selectedCell}
          teachers={teachers}
          onClose={() => setSelectedCell(null)}
        />
      )}

      {/* Add to Class Routine Modal */}
      {showAddToClassRoutineModal && (
        <AddToClassRoutineModal
          batchId={batchId}
          defaultDepartment={config?.department || (header?.department !== 'Department' ? header.department : '') || (batch?.semester || '')}
          defaultFaculty={config?.faculty || batch?.faculty || ''}
          defaultYear={config?.year || batch?.year || ''}
          defaultTerm={config?.semester || batch?.semester || ''}
          onClose={() => setShowAddToClassRoutineModal(false)}
          onSuccess={() => {
            setShowAddToClassRoutineModal(false);
          }}
        />
      )}
    </div>
  );
};



function StatusBadge({ status, hasSchedule }) {
  const map = {
    completed: 'bg-emerald-500/20 text-emerald-200 border-emerald-400/30',
    processing: 'bg-amber-500/20 text-amber-200 border-amber-400/30',
    failed: 'bg-red-500/20 text-red-200 border-red-400/30',
    needs_review: 'bg-orange-500/20 text-orange-200 border-orange-400/30',
  };
  const cls = map[status] || 'bg-slate-500/20 text-slate-200 border-slate-400/30';
  const label = hasSchedule && status === 'completed' ? 'Scheduled' : status || 'unknown';
  return (
    <span className={`text-[10px] uppercase tracking-widest font-semibold border px-2 py-0.5 rounded-full ${cls}`}>
      {String(label).replace(/_/g, ' ')}
    </span>
  );
}

function CountChip({ label, value, highlight }) {
  return (
    <div
      className={`rounded-xl border px-4 py-3 ${highlight
        ? 'bg-emerald-50 border-emerald-200'
        : 'bg-white border-slate-200'
        }`}
    >
      <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">
        {label}
      </p>
      <p className={`text-2xl font-bold ${highlight ? 'text-emerald-700' : 'text-ocean-800'}`}>
        {value ?? 0}
      </p>
    </div>
  );
}

/**
 * ValidationErrorPanel — renders the {errors, warnings} block stored in
 * upload_batches.error_log by validators.js.
 *
 * Each row has a "How do I fix this?" button that calls
 * `explainApi.explainValidatorError` and inlines a short AI suggestion
 * right under the row (no separate modal). The button is per-row so
 * different issues can be addressed independently.
 *
 *   shape of errorLog = {
 *     errors:   [{ rule, sheet, row, column, message, value? }],
 *     warnings: [{ rule, sheet, row, column, message, value? }]
 *   }
 */
function ValidationErrorPanel({ errorLog, batchId }) {
  const errors = errorLog?.errors || [];
  const warnings = errorLog?.warnings || [];
  if (errors.length === 0 && warnings.length === 0) return null;

  return (
    <div className="space-y-4">
      {errors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm">
          <div className="flex items-center gap-2 font-semibold text-red-800 mb-3">
            <AlertCircle className="w-5 h-5" />
            {errors.length} validation error{errors.length === 1 ? '' : 's'} prevented
            the workbook from being used as-is
          </div>
          <ul className="space-y-2">
            {errors.map((e, i) => (
              <ValidationRow
                key={`err-${i}`}
                issue={e}
                severity="error"
                batchId={batchId}
              />
            ))}
          </ul>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm">
          <div className="flex items-center gap-2 font-semibold text-amber-800 mb-3">
            <Sparkles className="w-5 h-5" />
            {warnings.length} warning{warnings.length === 1 ? '' : 's'} — your
            workbook was imported, but please review
          </div>
          <ul className="space-y-2">
            {warnings.map((w, i) => (
              <ValidationRow
                key={`warn-${i}`}
                issue={w}
                severity="warning"
                batchId={batchId}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ValidationRow({ issue, severity, batchId }) {
  // Per-row AI explanation state. We keep the explanation attached to
  // the row key so re-renders don't lose what we've already fetched.
  const [explanation, setExplanation] = useState(null);
  const [explaining, setExplaining] = useState(false);
  const [explainError, setExplainError] = useState(null);
  const [expanded, setExpanded] = useState(false);

  // Validators emit `rule`; the API accepts either `rule` or `code`.
  const ruleCode = issue.code || issue.rule || '—';
  const isError = severity === 'error';

  const askAi = async () => {
    if (explanation) {
      setExpanded((v) => !v);
      return;
    }
    setExplaining(true);
    setExplainError(null);
    setExpanded(true);
    try {
      const { explanation: text } = await explainApi.explainValidatorError(
        batchId,
        {
          rule: ruleCode,
          severity,
          message: issue.message,
          sheet: issue.sheet,
          row: issue.row,
          column: issue.column,
          value: issue.value,
        }
      );
      setExplanation(text);
    } catch (err) {
      const code = err.code;
      let msg = err.message || 'Failed to get explanation.';
      if (code === 'AI_UNAVAILABLE') {
        if (err.reason === 'no_api_key') {
          msg = 'AI assist is not configured on the server. Set OPENROUTER_API_KEY in backend/.env to enable.';
        } else if (err.reason === 'permission_denied') {
          msg = "AI assist is blocked: OpenRouter rejected the server's OPENROUTER_API_KEY " +
            '(HTTP 401/403/404). Verify the key is valid and that the configured ' +
            'OPENROUTER_MODEL is available for your account.';
        } else if (err.reason === 'rate_limited') {
          msg = 'AI service is rate-limited right now. Try again in a few seconds.';
        } else {
          msg = 'AI service is unavailable right now. Try again in a moment.';
        }
      } else if (code === 'AI_INVALID_RESPONSE') {
        msg = 'The AI could not explain that issue. Try again.';
      }
      setExplainError(msg);
    } finally {
      setExplaining(false);
    }
  };

  const location = [];
  if (issue.sheet) location.push(issue.sheet);
  if (issue.row) location.push(`row ${issue.row}`);
  if (issue.column) location.push(issue.column);

  const ruleChipClass = isError
    ? 'bg-red-200 text-red-900'
    : 'bg-amber-200 text-amber-900';

  return (
    <li
      className={`rounded-lg border px-3 py-2 ${isError ? 'bg-white border-red-200' : 'bg-white border-amber-200'
        }`}
    >
      <div className="flex items-start gap-3">
        <span className={`font-mono text-[11px] px-1.5 py-0.5 rounded shrink-0 mt-0.5 ${ruleChipClass}`}>
          {ruleCode}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-slate-800 leading-snug">{issue.message}</div>
          {location.length > 0 && (
            <div className="text-[11px] text-slate-500 mt-0.5 font-mono">
              {location.join(' · ')}
            </div>
          )}
          {expanded && (
            <div className="mt-2 rounded-md bg-sky-50 border border-sky-200 px-3 py-2 text-xs text-sky-900">
              {explaining && (
                <span className="inline-flex items-center gap-2 text-sky-700">
                  <Loader2 className="w-3 h-3 animate-spin" /> Asking the AI assistant…
                </span>
              )}
              {!explaining && explainError && (
                <span className="text-red-700">{explainError}</span>
              )}
              {!explaining && explanation && (
                <p className="leading-relaxed whitespace-pre-wrap">
                  {explanation}
                </p>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={askAi}
          disabled={explaining}
          className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 px-2 py-1 rounded-md transition-colors disabled:opacity-50"
          title={explanation ? 'Toggle AI explanation' : 'Ask the AI how to fix this'}
        >
          <Sparkles className="w-3 h-3" />
          {explanation ? (expanded ? 'Hide fix' : 'Show fix') : 'How do I fix this?'}
        </button>
      </div>
    </li>
  );
}

export default RoutinePage;
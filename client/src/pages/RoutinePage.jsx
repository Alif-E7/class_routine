import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Calendar,
  Loader2,
  Play,
  RotateCw,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  FileDown,
  MessageSquareText,
  ChevronDown,
  ChevronUp,
  Send,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { batchesApi, routineApi, exportApi, editApi } from '../api/client';
import RoutineGrid from '../components/RoutineGrid';

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
  const [teachers, setTeachers] = useState([]);
  const [header, setHeader] = useState({
    university: 'Gopalganj Science and Technology University',
    department: 'Computer Science and Engineering',
    semester: '',
  });

  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [friendlyHint, setFriendlyHint] = useState(null);

  // Ask-AI state (Step 8 — advisory edit drafts only).
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiProposal, setAiProposal] = useState(null);
  const [aiError, setAiError] = useState(null);

  const loadRoutine = useCallback(async () => {
    setLoading(true);
    setError(null);
    setFriendlyHint(null);
    try {
      const [detailRes, scheduleRes] = await Promise.all([
        batchesApi.detail(batchId),
        routineApi.getRoutine(batchId),
      ]);

      const b = detailRes.data.batch;
      setBatch(b);
      setHeader({
        university: 'Gopalganj Science and Technology University',
        department: 'Computer Science and Engineering',
        semester: b?.semester || '',
      });
      setAssignments(scheduleRes.data.assignments || []);
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

  // Try to fetch teachers for the legend — endpoint does not exist yet in
  // the new API, so we degrade silently. The legend will be hidden when empty.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // No /api/batches/:id/teachers route yet. We will surface this in a
        // later task (Phase 7+). For now, leave teachers empty.
        if (cancelled) return;
        setTeachers([]);
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

  const handleAskAi = async () => {
    const text = aiPrompt.trim();
    if (text.length < 8) {
      toast.error('Please describe the change in at least 8 characters.');
      return;
    }
    if (!Number.isInteger(batchId) || batchId <= 0) {
      toast.error('Invalid batch id.');
      return;
    }
    setAiBusy(true);
    setAiError(null);
    const tid = toast.loading('Asking the AI assistant…');
    try {
      const { proposal } = await editApi.askEdit(batchId, text);
      setAiProposal(proposal);
      toast.success('Got a proposal. Review below before applying.', { id: tid });
    } catch (err) {
      const code = err.code;
      let msg;
      if (code === 'AI_UNAVAILABLE') {
        msg = err.reason === 'no_api_key'
          ? 'AI assist is not configured on the server. Set GEMINI_API_KEY in backend/.env to enable.'
          : 'AI service is unavailable right now. Try again in a moment.';
      } else if (code === 'AI_INVALID_RESPONSE') {
        msg = 'The AI could not turn that request into a structured edit. Try rewording it.';
      } else if (code === 'BATCH_NOT_READY') {
        msg = 'Generate the routine first.';
      } else if (code === 'BATCH_NOT_FOUND') {
        msg = 'Batch not found.';
      } else if (code === 'INVALID_PROMPT') {
        msg = err.message || 'Prompt too short or too long.';
      } else {
        msg = err.message || 'Failed to contact AI assistant.';
      }
      setAiError({ code, message: msg });
      toast.error(msg, { id: tid, duration: 6000 });
    } finally {
      setAiBusy(false);
    }
  };

  const handleDownload = async (kind) => {
    if (!hasSchedule) {
      toast.error('Generate the routine first.');
      return;
    }
    setDownloading(kind);
    const tid = toast.loading(
      kind === 'docx' ? 'Building Word document…' : 'Converting to PDF…'
    );
    try {
      const { filename } = kind === 'docx'
        ? await exportApi.downloadDocx(batchId)
        : await exportApi.downloadPdf(batchId);
      toast.success(`Downloaded ${filename}`, { id: tid });
    } catch (err) {
      const msg = err.code === 'PDF_UNAVAILABLE'
        ? 'PDF export needs LibreOffice on the server. Try Download Word instead.'
        : err.code === 'NO_SCHEDULE'
          ? 'Generate the routine first.'
          : err.message || `Failed to download ${kind.toUpperCase()}.`;
      toast.error(msg, { id: tid, duration: 6000 });
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

  return (
    <div className="max-w-[1400px] mx-auto space-y-6">
      {/* Header card */}
      <div className="bg-linear-to-br from-ocean-900 to-ocean-800 rounded-2xl px-6 py-5 text-white border border-sky-500/15 shadow-lg flex items-center gap-4">
        <button
          onClick={() => navigate('/history')}
          className="bg-white/10 hover:bg-white/20 p-2 rounded-lg transition-colors"
          title="Back to history"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <Calendar className="w-4 h-4 text-sky-400" />
            <span className="text-xs font-semibold tracking-widest uppercase text-sky-400">
              Batch #{batchId}
            </span>
            <StatusBadge status={batch?.status} hasSchedule={hasSchedule} />
          </div>
          <h1 className="text-xl font-bold">{batch?.filename || 'Routine'}</h1>
          <p className="text-sky-300 text-sm">
            {batch?.semester || 'No semester label'} · Imported{' '}
            {batch?.created_at
              ? new Date(batch.created_at).toLocaleString()
              : '—'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={loadRoutine}
            disabled={generating}
            className="bg-white/10 hover:bg-white/20 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-50"
            title="Refresh"
          >
            <RotateCw className="w-4 h-4" /> Refresh
          </button>
          <button
            onClick={() => handleDownload('docx')}
            disabled={!hasSchedule || downloading != null || generating}
            className="bg-white/10 hover:bg-white/20 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            title={hasSchedule ? 'Download as .docx' : 'Generate the routine first'}
          >
            {downloading === 'docx' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <FileText className="w-4 h-4" />
            )}
            Download Word
          </button>
          <button
            onClick={() => handleDownload('pdf')}
            disabled={!hasSchedule || downloading != null || generating}
            className="bg-white/10 hover:bg-white/20 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            title={hasSchedule ? 'Download as .pdf (needs LibreOffice on server)' : 'Generate the routine first'}
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
            className="bg-sky-500 hover:bg-sky-400 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2 disabled:opacity-50"
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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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

      {/* Ask AI — Step 8 advisory edit drafts (does not mutate the schedule) */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <button
          type="button"
          onClick={() => {
            setAiOpen((v) => !v);
            setAiError(null);
          }}
          className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-slate-50 transition-colors"
          aria-expanded={aiOpen}
        >
          <span className="flex items-center gap-2 text-slate-800 font-semibold">
            <Sparkles className="w-4 h-4 text-sky-600" />
            Ask the AI to draft an edit
            <span className="text-[10px] uppercase tracking-widest font-bold text-sky-700 bg-sky-100 px-2 py-0.5 rounded-full">
              Step 8 · preview
            </span>
          </span>
          {aiOpen ? (
            <ChevronUp className="w-5 h-5 text-slate-500" />
          ) : (
            <ChevronDown className="w-5 h-5 text-slate-500" />
          )}
        </button>

        {aiOpen && (
          <div className="px-5 pb-5 pt-1 border-t border-slate-100 space-y-3">
            <p className="text-xs text-slate-500 leading-relaxed">
              Describe the change in plain English — for example
              <span className="font-mono text-slate-700"> “move CSE406 from Sunday 9am to Monday 10am”</span>.
              The assistant returns a <em>proposal</em> you review here; nothing is changed in the database.
              Requires a schedule to already exist.
            </p>

            <div className="flex flex-col sm:flex-row gap-3">
              <textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                rows={3}
                disabled={!hasSchedule || aiBusy}
                placeholder={
                  hasSchedule
                    ? 'e.g. Please move CSE406 from SUN 9am to MON 10am.'
                    : 'Generate the routine first.'
                }
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-300 disabled:bg-slate-50 disabled:text-slate-400 resize-y"
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault();
                    if (!aiBusy && hasSchedule && aiPrompt.trim().length >= 8) {
                      handleAskAi();
                    }
                  }
                }}
              />
              <button
                onClick={handleAskAi}
                disabled={!hasSchedule || aiBusy || aiPrompt.trim().length < 8}
                className="bg-sky-600 hover:bg-sky-500 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed sm:w-40"
              >
                {aiBusy ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Asking…
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" /> Ask AI
                  </>
                )}
              </button>
            </div>

            {/* Error pill (inline, does not replace the toast) */}
            {aiError && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <div className="font-semibold">
                    {aiError.code === 'AI_UNAVAILABLE'
                      ? 'AI assist unavailable'
                      : aiError.code === 'AI_INVALID_RESPONSE'
                        ? 'AI returned an unparseable response'
                        : 'Request failed'}
                  </div>
                  <p className="leading-relaxed mt-0.5">{aiError.message}</p>
                </div>
              </div>
            )}

            {/* Proposal card */}
            {aiProposal && <AiProposalCard proposal={aiProposal} />}
          </div>
        )}
      </div>

      {/* Validation errors from upload step (if any) */}
      {batch?.error_log && (
        <ValidationErrorPanel errorLog={batch.error_log} />
      )}

      {/* Routine grid */}
      <RoutineGrid assignments={assignments} header={header} teachers={teachers} />

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
    </div>
  );
};

function AiProposalCard({ proposal }) {
  if (!proposal) return null;
  const { kind, summary, change, question, concerns } = proposal;
  const kindLabel = {
    proposed_change: 'Proposed change',
    clarifying_question: 'Need more info',
    explanation: 'Explanation',
  }[kind] || 'Proposal';
  const kindClasses = {
    proposed_change: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    clarifying_question: 'bg-amber-50 border-amber-200 text-amber-800',
    explanation: 'bg-sky-50 border-sky-200 text-sky-800',
  }[kind] || 'bg-slate-50 border-slate-200 text-slate-800';

  return (
    <div className={`rounded-xl border p-4 ${kindClasses}`}>
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <MessageSquareText className="w-4 h-4" />
          <span className="text-[10px] uppercase tracking-widest font-bold">
            {kindLabel}
          </span>
        </div>
        <span className="text-[10px] text-slate-500">
          advisory only — nothing was applied
        </span>
      </div>
      {summary && (
        <p className="text-sm leading-relaxed font-medium mb-2">{summary}</p>
      )}
      {change && (
        <div className="bg-white/70 rounded-lg border border-current/10 px-3 py-2 text-xs font-mono leading-relaxed mt-1">
          <div>
            <span className="opacity-60">course:</span> {change.course_code}
          </div>
          <div>
            <span className="opacity-60">from:</span> {change.from.day}{' '}
            {String(change.from.slot_start).padStart(4, '0').replace(/^(\d{2})(\d{2})$/, '$1:$2')}
            –
            {String(change.from.slot_end).padStart(4, '0').replace(/^(\d{2})(\d{2})$/, '$1:$2')}
          </div>
          <div>
            <span className="opacity-60">to:</span> {change.to.day}{' '}
            {String(change.to.slot_start).padStart(4, '0').replace(/^(\d{2})(\d{2})$/, '$1:$2')}
            –
            {String(change.to.slot_end).padStart(4, '0').replace(/^(\d{2})(\d{2})$/, '$1:$2')}
          </div>
        </div>
      )}
      {question && (
        <p className="text-sm leading-relaxed mt-1">{question}</p>
      )}
      {Array.isArray(concerns) && concerns.length > 0 && (
        <details className="mt-2">
          <summary className="text-xs cursor-pointer underline underline-offset-2 opacity-80">
            {concerns.length} concern{concerns.length === 1 ? '' : 's'} flagged
          </summary>
          <ul className="mt-2 list-disc list-inside text-xs leading-relaxed">
            {concerns.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </details>
      )}
      <p className="mt-3 text-[11px] opacity-70 italic">
        Applying this proposal would require a separate /apply endpoint (not part of Step 8).
      </p>
    </div>
  );
}

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
      className={`rounded-xl border px-4 py-3 ${
        highlight
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

function ValidationErrorPanel({ errorLog }) {
  // errorLog shape (from validators.js): { errors: [{rule, sheet, row, column, message}], warnings: [...] }
  const errors = errorLog?.errors || [];
  const warnings = errorLog?.warnings || [];
  if (errors.length === 0 && warnings.length === 0) return null;
  return (
    <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm">
      <div className="flex items-center gap-2 font-semibold text-red-800 mb-2">
        <AlertCircle className="w-5 h-5" />
        Validation found {errors.length} error{errors.length === 1 ? '' : 's'}
        {warnings.length > 0 && ` and ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`}.
      </div>
      {errors.length > 0 && (
        <ul className="list-disc list-inside text-red-700 space-y-1">
          {errors.slice(0, 8).map((e, i) => (
            <li key={i}>
              <span className="font-mono text-xs bg-red-100 px-1.5 py-0.5 rounded mr-2">
                {e.rule}
              </span>
              {e.sheet ? <span className="text-xs text-red-600">{e.sheet}</span> : null}
              {e.row ? <span className="text-xs text-red-500"> row {e.row}</span> : null}
              {e.column ? <span className="text-xs text-red-500"> · {e.column}</span> : null}
              {' — '}
              {e.message}
            </li>
          ))}
          {errors.length > 8 && (
            <li className="text-red-600 italic">…and {errors.length - 8} more.</li>
          )}
        </ul>
      )}
    </div>
  );
}

export default RoutinePage;
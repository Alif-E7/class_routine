import React, { useState, useEffect, useRef } from 'react';
import { MessageSquareText, X, Send, Sparkles, Loader2, AlertCircle, Minimize2, ChevronUp } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { editApi } from '../api/client';

export function AiProposalCard({ proposal }) {
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
    <div className={`rounded-xl border p-4 ${kindClasses} mt-2 w-full text-left shadow-sm`}>
      <style>{`
        .markdown-body p { margin-bottom: 0.75rem; }
        .markdown-body p:last-child { margin-bottom: 0; }
        .markdown-body ul { list-style-type: disc; margin-left: 1.25rem; margin-bottom: 0.75rem; }
        .markdown-body ol { list-style-type: decimal; margin-left: 1.25rem; margin-bottom: 0.75rem; }
        .markdown-body li { margin-bottom: 0.25rem; }
        .markdown-body strong { font-weight: 700; }
        .markdown-body table { border-collapse: collapse; width: 100%; margin-bottom: 0.75rem; font-size: 12px; }
        .markdown-body th, .markdown-body td { border: 1px solid rgba(0,0,0,0.1); padding: 4px 8px; }
        .markdown-body th { background-color: rgba(0,0,0,0.05); font-weight: 600; }
      `}</style>
      <div className="flex items-center justify-between gap-3 mb-2 border-b border-current/10 pb-1.5">
        <div className="flex items-center gap-2">
          <MessageSquareText className="w-4 h-4" />
          <span className="text-[10px] uppercase tracking-widest font-bold">
            {kindLabel}
          </span>
        </div>
        <span className="text-[10px] opacity-60">
          advisory only
        </span>
      </div>
      {summary && (
        <div className="text-sm leading-relaxed font-medium mb-3 markdown-body">
          <ReactMarkdown>{summary}</ReactMarkdown>
        </div>
      )}
      {change && (
        <div className="bg-white/80 rounded-lg border border-current/10 px-3 py-2.5 text-xs font-mono leading-relaxed mt-1 shadow-inner">
          <div className="font-semibold text-[10px] text-slate-500 uppercase tracking-wider mb-1">Proposed Edit Payload</div>
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
        <div className="text-sm leading-relaxed mt-1 markdown-body">
          <ReactMarkdown>{question}</ReactMarkdown>
        </div>
      )}
      {Array.isArray(concerns) && concerns.length > 0 && (
        <details className="mt-3 bg-black/5 rounded-lg p-2.5 border border-black/5">
          <summary className="text-xs font-semibold cursor-pointer underline underline-offset-2 opacity-80 select-none">
            {concerns.length} concern{concerns.length === 1 ? '' : 's'} flagged
          </summary>
          <ul className="mt-2 list-disc list-inside text-xs leading-relaxed opacity-90 space-y-1">
            {concerns.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export default function FloatingAiChat({ batchId, score, hasSchedule }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const messagesEndRef = useRef(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen, isMinimized]);

  if (!hasSchedule) return null;

  const handleClose = () => {
    setIsOpen(false);
    setIsMinimized(false);
    setMessages([]);
    setInputValue('');
  };

  const sendText = async (text) => {
    if (!text.trim()) return;

    const newMessages = [...messages, { role: 'user', content: text }];
    setMessages(newMessages);
    setInputValue('');
    setIsBusy(true);

    try {
      const history = messages.map(m => ({
        role: m.role,
        content: m.role === 'ai' ? (m.proposal?.summary || m.content) : m.content
      }));

      const { proposal } = await editApi.askEdit(batchId, text, score, history);
      setMessages([...newMessages, { role: 'ai', proposal }]);
    } catch (err) {
      const code = err.code;
      let msg = 'Failed to contact AI assistant.';
      if (code === 'AI_UNAVAILABLE') {
        msg = err.reason === 'no_api_key'
          ? 'AI assist is not configured on the server. Set OPENROUTER_API_KEY in backend/.env to enable.'
          : 'AI service is unavailable right now. Try again in a moment.';
      } else if (code === 'AI_INVALID_RESPONSE') {
        msg = 'The AI could not return a structured response. Try rewording it.';
      } else if (code === 'AI_RATE_LIMIT') {
        msg = 'API Rate Limit exceeded. Please wait a moment before asking again.';
      } else if (code === 'AI_AUTH_ERROR') {
        msg = 'API Key rejected. Please ensure your OPENROUTER_API_KEY is correct.';
      } else if (code === 'INVALID_PROMPT') {
        msg = err.message || 'Prompt too short or too long.';
      } else if (err.message) {
        msg = err.message;
      }
      setMessages([...newMessages, { role: 'error', content: msg }]);
    } finally {
      setIsBusy(false);
    }
  };

  const handleSend = () => {
    sendText(inputValue);
  };

  // Determine dynamic suggestions based on conversation state
  const getSuggestions = () => {
    if (messages.length === 0) {
      return [
        { text: 'Explain schedule pros & cons', type: 'advisory' },
        { text: 'How can we optimize room usage?', type: 'advisory' },
        { text: 'Suggest a manual schedule change', type: 'act' }
      ];
    }
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role === 'user') return [];
    
    if (lastMsg.role === 'ai' && lastMsg.proposal) {
      const { kind } = lastMsg.proposal;
      if (kind === 'proposed_change') {
        return [
          { text: 'Check for teacher conflicts with this change', type: 'act' },
          { text: 'Explain the benefits of this change', type: 'advisory' },
          { text: 'Are there any alternative changes?', type: 'advisory' }
        ];
      }
      if (kind === 'explanation') {
        return [
          { text: 'Suggest optimization changes', type: 'act' },
          { text: 'Show teacher availability summary', type: 'advisory' },
          { text: 'What is the schedule quality score?', type: 'advisory' }
        ];
      }
    }
    return [
      { text: 'Explain schedule quality score', type: 'advisory' },
      { text: 'Check for room allocation conflicts', type: 'act' },
      { text: 'Suggest a course rescheduling', type: 'act' }
    ];
  };

  const suggestions = getSuggestions();

  if (isMinimized && isOpen) {
    return (
      <div 
        onClick={() => setIsMinimized(false)}
        className="print:hidden fixed bottom-6 right-6 w-80 bg-sky-600 hover:bg-sky-500 text-white rounded-xl shadow-2xl px-4 py-3 flex items-center justify-between cursor-pointer transition-all hover:scale-105 z-50 select-none border border-sky-400/20"
      >
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-sky-200 animate-pulse" />
          <span className="font-semibold text-xs tracking-wider uppercase">AI Assistant (Minimized)</span>
        </div>
        <ChevronUp className="w-4 h-4" />
      </div>
    );
  }

  return (
    <>
      {/* Floating Button */}
      <button
        onClick={() => setIsOpen(true)}
        className={`print:hidden fixed bottom-6 right-6 p-4 rounded-full shadow-2xl bg-sky-600 hover:bg-sky-500 text-white transition-all transform hover:scale-105 z-40 ${isOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
        aria-label="Open AI Assistant"
      >
        <Sparkles className="w-6 h-6 animate-pulse" />
      </button>

      {/* Chat Window */}
      <div
        className={`print:hidden fixed bottom-6 right-6 w-[480px] h-[650px] max-h-[85vh] max-w-[95vw] bg-white rounded-2xl shadow-2xl flex flex-col border border-slate-200 transition-all transform z-50 origin-bottom-right ${isOpen ? 'scale-100 opacity-100' : 'scale-95 opacity-0 pointer-events-none'
          }`}
      >
        {/* Header */}
        <div className="bg-linear-to-r from-sky-600 to-sky-700 p-4 rounded-t-2xl flex items-center justify-between text-white shadow-sm shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-sky-200" />
            <h3 className="font-semibold text-sm">AI Assistant</h3>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setIsMinimized(true)}
              className="p-1.5 hover:bg-white/20 rounded-md transition-colors"
              title="Minimize chat"
            >
              <Minimize2 className="w-4.5 h-4.5" />
            </button>
            <button
              onClick={handleClose}
              className="p-1.5 hover:bg-white/20 rounded-md transition-colors"
              aria-label="Close chat"
            >
              <X className="w-4.5 h-4.5" />
            </button>
          </div>
        </div>

        {/* Message Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50">
          {messages.length === 0 && (
            <div className="text-center mt-12 space-y-4">
              <Sparkles className="w-12 h-12 text-sky-300 mx-auto animate-bounce" />
              <div className="space-y-1">
                <h4 className="font-semibold text-slate-800 text-sm">Timetable Advisor</h4>
                <p className="text-xs text-slate-500 px-8 leading-relaxed">
                  Ask me about this routine's quality constraints, or suggest changes like "Reschedule CSE101 to Monday".
                </p>
              </div>
            </div>
          )}

          {messages.map((m, idx) => (
            <div key={idx} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[90%] rounded-2xl px-4 py-2.5 text-sm shadow-sm ${m.role === 'user'
                ? 'bg-sky-600 text-white rounded-tr-none'
                : m.role === 'error'
                  ? 'bg-red-50 border border-red-200 text-red-800 rounded-tl-none'
                  : 'bg-white border border-slate-200 text-slate-800 rounded-tl-none'
                }`}>
                {m.role === 'user' && m.content}
                {m.role === 'error' && (
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <p>{m.content}</p>
                  </div>
                )}
                {m.role === 'ai' && <AiProposalCard proposal={m.proposal} />}
              </div>
            </div>
          ))}

          {isBusy && (
            <div className="flex justify-start">
              <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-none px-4 py-3 shadow-sm">
                <Loader2 className="w-4 h-4 text-sky-600 animate-spin" />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Suggestion Chips Area */}
        {!isBusy && suggestions.length > 0 && (
          <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 flex flex-wrap gap-2 shrink-0 select-none">
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => sendText(s.text)}
                className={`text-xs px-2.5 py-1.5 rounded-full border transition-all duration-200 text-left hover:scale-[1.02] shadow-xs active:scale-[0.98] ${
                  s.type === 'act'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 hover:text-emerald-800'
                    : 'bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100 hover:text-sky-800'
                }`}
              >
                {s.text}
              </button>
            ))}
          </div>
        )}

        {/* Input Area */}
        <div className="p-3.5 bg-white border-t border-slate-100 rounded-b-2xl shrink-0">
          <div className="flex gap-2 relative">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Ask anything..."
              className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:bg-white transition-all pr-10"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              disabled={isBusy}
            />
            <button
              onClick={handleSend}
              disabled={isBusy || !inputValue.trim()}
              className="absolute right-1 top-1 bottom-1 p-2 bg-sky-600 text-white rounded-lg hover:bg-sky-500 disabled:opacity-50 transition-colors flex items-center justify-center"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

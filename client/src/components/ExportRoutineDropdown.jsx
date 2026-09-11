import React, { useState, useRef, useEffect } from 'react';
import {
  Download,
  Loader2,
  ChevronDown,
  FileSpreadsheet,
  FileText,
  FileDown,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { exportRoutineToPdf } from '../utils/pdfExport';
import { exportRoutineToCsv } from '../utils/csvExport';
import { exportApi } from '../api/client';

/**
 * ExportRoutineDropdown — Unified export menu supporting:
 *   1. Tabular CSV (.csv)
 *   2. Word Document (.docx)
 *   3. PDF — Landscape Mode
 *   4. PDF — Portrait Mode
 *
 * Clean and compact menu without excessive text descriptions.
 */
const ExportRoutineDropdown = ({
  batchId,
  assignments = [],
  teachers = [],
  filename = 'routine',
  disabled = false,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [downloadingType, setDownloadingType] = useState(null); // 'csv' | 'docx' | 'pdf-landscape' | 'pdf-portrait' | null
  const menuRef = useRef(null);

  // Close dropdown on click outside or Escape
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleDownloadCsv = () => {
    setDownloadingType('csv');
    setIsOpen(false);
    try {
      exportRoutineToCsv({
        assignments,
        teachers,
        filename,
      });
    } finally {
      setDownloadingType(null);
    }
  };

  const handleDownloadDocx = async () => {
    if (!batchId) {
      toast.error('Batch ID is required for DOCS export.');
      return;
    }
    setDownloadingType('docx');
    setIsOpen(false);
    const tid = toast.loading('Generating Word (.docx) document…');
    try {
      await exportApi.downloadDocx(batchId);
      toast.success('Word document (.docx) downloaded successfully!', { id: tid });
    } catch (err) {
      console.error('DOCX export error:', err);
      toast.error(err.message || 'Failed to download Word document.', { id: tid });
    } finally {
      setDownloadingType(null);
    }
  };

  const handleDownloadPdf = async (orientation) => {
    setDownloadingType(`pdf-${orientation}`);
    setIsOpen(false);
    try {
      await exportRoutineToPdf({
        orientation,
        filename,
      });
    } catch (_err) {
      // Toast notification is handled inside exportRoutineToPdf
    } finally {
      setDownloadingType(null);
    }
  };

  const isBusy = downloadingType !== null;

  return (
    <div className="relative inline-block text-left" ref={menuRef}>
      <button
        type="button"
        onClick={() => !disabled && !isBusy && setIsOpen((prev) => !prev)}
        disabled={disabled || isBusy}
        className={`w-full sm:w-auto bg-white/10 hover:bg-white/20 active:bg-white/30 text-white px-3.5 sm:px-4 py-2.5 sm:py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center justify-between sm:justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer min-h-[42px] sm:min-h-0 shadow-xs border border-white/10 ${className}`}
        title="Download Routine as CSV, DOCS, or PDF"
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <div className="flex items-center gap-1.5">
          {isBusy ? (
            <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
          ) : (
            <Download className="w-4 h-4 text-sky-300" />
          )}
          <span>
            {isBusy
              ? downloadingType === 'csv'
                ? 'Exporting CSV…'
                : downloadingType === 'docx'
                ? 'Generating DOCS…'
                : 'Generating PDF…'
              : 'Export Routine'}
          </span>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-sky-300 transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          className="absolute right-0 left-0 sm:left-auto mt-2 w-56 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-50 animate-in fade-in-50 zoom-in-95 duration-150 origin-top-right text-slate-800"
          role="menu"
          aria-orientation="vertical"
        >
          {/* Header */}
          <div className="px-3.5 py-1.5 border-b border-slate-100 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Download Format
            </span>
          </div>

          <div className="p-1 space-y-0.5">
            {/* Option 1: Tabular CSV */}
            <button
              type="button"
              onClick={handleDownloadCsv}
              disabled={isBusy}
              className="w-full px-3 py-2.5 text-left hover:bg-emerald-50 active:bg-emerald-100/70 rounded-lg transition-colors flex items-center justify-between group cursor-pointer"
              role="menuitem"
            >
              <div className="flex items-center gap-2.5">
                <FileSpreadsheet className="w-4 h-4 text-emerald-600 group-hover:scale-110 transition-transform shrink-0" />
                <span className="text-xs font-semibold text-slate-800 group-hover:text-emerald-900 transition-colors">
                  Tabular CSV (.csv)
                </span>
              </div>
              {downloadingType === 'csv' && (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600 shrink-0 ml-2" />
              )}
            </button>

            {/* Option 2: Word DOCS (.docx) */}
            <button
              type="button"
              onClick={handleDownloadDocx}
              disabled={isBusy}
              className="w-full px-3 py-2.5 text-left hover:bg-blue-50 active:bg-blue-100/70 rounded-lg transition-colors flex items-center justify-between group cursor-pointer"
              role="menuitem"
            >
              <div className="flex items-center gap-2.5">
                <FileText className="w-4 h-4 text-blue-600 group-hover:scale-110 transition-transform shrink-0" />
                <span className="text-xs font-semibold text-slate-800 group-hover:text-blue-900 transition-colors">
                  Word Document (.docx)
                </span>
              </div>
              {downloadingType === 'docx' && (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600 shrink-0 ml-2" />
              )}
            </button>

            <div className="h-px bg-slate-100 my-1" />

            {/* Option 3: PDF Landscape */}
            <button
              type="button"
              onClick={() => handleDownloadPdf('landscape')}
              disabled={isBusy}
              className="w-full px-3 py-2.5 text-left hover:bg-rose-50 active:bg-rose-100/70 rounded-lg transition-colors flex items-center justify-between group cursor-pointer"
              role="menuitem"
            >
              <div className="flex items-center gap-2.5">
                <FileDown className="w-4 h-4 text-rose-500 group-hover:scale-110 transition-transform shrink-0" />
                <span className="text-xs font-semibold text-slate-800 group-hover:text-rose-900 transition-colors">
                  PDF — Landscape Mode
                </span>
              </div>
              {downloadingType === 'pdf-landscape' && (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-600 shrink-0 ml-2" />
              )}
            </button>

            {/* Option 4: PDF Portrait */}
            <button
              type="button"
              onClick={() => handleDownloadPdf('portrait')}
              disabled={isBusy}
              className="w-full px-3 py-2.5 text-left hover:bg-rose-50 active:bg-rose-100/70 rounded-lg transition-colors flex items-center justify-between group cursor-pointer"
              role="menuitem"
            >
              <div className="flex items-center gap-2.5">
                <FileDown className="w-4 h-4 text-rose-500 group-hover:scale-110 transition-transform shrink-0" />
                <span className="text-xs font-semibold text-slate-800 group-hover:text-rose-900 transition-colors">
                  PDF — Portrait Mode
                </span>
              </div>
              {downloadingType === 'pdf-portrait' && (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-600 shrink-0 ml-2" />
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExportRoutineDropdown;

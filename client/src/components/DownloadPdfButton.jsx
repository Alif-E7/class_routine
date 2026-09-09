import React, { useState, useRef, useEffect } from 'react';
import {
  Download,
  Loader2,
  ChevronDown,
} from 'lucide-react';
import { exportRoutineToPdf } from '../utils/pdfExport';

/**
 * DownloadPdfButton — A dropdown button allowing the user to choose
 * between Landscape and Portrait orientation when downloading the routine timetable PDF.
 *
 * @param {Object} props
 * @param {string} [props.filename='routine']
 * @param {boolean} [props.disabled=false]
 * @param {string} [props.className]
 */
const DownloadPdfButton = ({
  filename = 'routine',
  disabled = false,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [downloadingMode, setDownloadingMode] = useState(null); // 'landscape' | 'portrait' | null
  const menuRef = useRef(null);

  // Close dropdown on click outside
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

  const handleDownload = async (orientation) => {
    setDownloadingMode(orientation);
    setIsOpen(false);
    try {
      await exportRoutineToPdf({
        orientation,
        filename,
      });
    } catch (_err) {
      // Toast notification is already handled inside exportRoutineToPdf
    } finally {
      setDownloadingMode(null);
    }
  };

  const isBusy = downloadingMode !== null;

  return (
    <div className="relative inline-block text-left" ref={menuRef}>
      <button
        type="button"
        onClick={() => !disabled && !isBusy && setIsOpen((prev) => !prev)}
        disabled={disabled || isBusy}
        className={`w-full sm:w-auto bg-white/10 hover:bg-white/20 active:bg-white/30 text-white px-3.5 sm:px-4 py-2.5 sm:py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center justify-between sm:justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer min-h-[42px] sm:min-h-0 shadow-xs border border-white/10 ${className}`}
        title="Download Routine as PDF in Landscape or Portrait mode"
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <div className="flex items-center gap-1.5">
          {isBusy ? (
            <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
          ) : (
            <Download className="w-4 h-4 text-sky-300" />
          )}
          <span>{isBusy ? `Generating ${downloadingMode}…` : 'Download PDF'}</span>
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
          className="absolute right-0 sm:right-0 left-0 sm:left-auto mt-2 w-48 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-50 animate-in fade-in-50 zoom-in-95 duration-150 origin-top-right text-slate-800"
          role="menu"
          aria-orientation="vertical"
        >
          {/* Option 1: Landscape Mode */}
          <button
            type="button"
            onClick={() => handleDownload('landscape')}
            disabled={isBusy}
            className="w-full px-3.5 py-2.5 text-left hover:bg-slate-100 active:bg-slate-200 transition-colors flex items-center justify-between group cursor-pointer"
            role="menuitem"
          >
            <div className="flex items-center gap-2.5">
              <svg
                className="w-4 h-3.5 text-slate-600 group-hover:text-slate-900 transition-colors shrink-0"
                viewBox="0 0 24 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="1" y="1" width="22" height="14" rx="2" ry="2" />
                <line x1="1" y1="5" x2="23" y2="5" />
              </svg>
              <span className="text-xs font-semibold text-slate-800 group-hover:text-slate-900 transition-colors whitespace-nowrap">
                Landscape Mode
              </span>
            </div>

            {downloadingMode === 'landscape' && (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-600 shrink-0 ml-2" />
            )}
          </button>

          {/* Option 2: Portrait Mode */}
          <button
            type="button"
            onClick={() => handleDownload('portrait')}
            disabled={isBusy}
            className="w-full px-3.5 py-2.5 text-left hover:bg-slate-100 active:bg-slate-200 transition-colors flex items-center justify-between group cursor-pointer"
            role="menuitem"
          >
            <div className="flex items-center gap-2.5">
              <svg
                className="w-3.5 h-4 text-slate-600 group-hover:text-slate-900 transition-colors shrink-0"
                viewBox="0 0 16 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="1" y="1" width="14" height="22" rx="2" ry="2" />
                <line x1="1" y1="6" x2="15" y2="6" />
              </svg>
              <span className="text-xs font-semibold text-slate-800 group-hover:text-slate-900 transition-colors whitespace-nowrap">
                Portrait Mode
              </span>
            </div>

            {downloadingMode === 'portrait' && (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-600 shrink-0 ml-2" />
            )}
          </button>
        </div>
      )}
    </div>
  );
};

export default DownloadPdfButton;

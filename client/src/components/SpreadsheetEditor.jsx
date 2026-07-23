import React, { useState, useEffect } from 'react';
import { batchesApi, explainApi } from '../api/client';
import { X, Save, Plus, Trash2, Loader2, AlertCircle, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import Spreadsheet from 'react-spreadsheet';

const SHEETS = [
  { name: 'Config', workbookKey: 'config', cols: ['key', 'value'] },
  { name: 'Teachers', workbookKey: 'teachers', cols: ['full_name', 'abbreviation', 'designation', 'department'] },
  { name: 'Courses', workbookKey: 'courses', cols: ['course_code', 'course_name', 'credit', 'dept', 'year_sem', 'teacher_abbr'] },
  { name: 'Rooms', workbookKey: 'rooms', cols: ['room_id', 'room_name', 'type'] },
  { name: 'Credit Rules', workbookKey: 'credit_rules', cols: ['credit', 'classes_per_week', 'duration_minutes'] },
  { name: 'Room Preference', workbookKey: 'room_preference', cols: ['room_id', 'year_group', 'weight_percent'] },
  { name: 'Day Preference', workbookKey: 'day_preference', cols: ['day', 'class_type', 'weight_percent', 'note'] },
  { name: 'Teacher Unavailability', workbookKey: 'teacher_unavailability', cols: ['teacher_abbr', 'day', 'start_time', 'end_time'] },
  { name: 'Year Sem', workbookKey: 'year_sem', cols: ['year_sem', 'year', 'semester', 'group_code', 'is_active'] },
];

const SpreadsheetEditor = ({ batchId, batchName, onClose, onSaveSuccess }) => {
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeSheet, setActiveSheet] = useState(SHEETS[0].name);
  const [validationErrors, setValidationErrors] = useState([]);
  const [activeCell, setActiveCell] = useState(null);
  const [explainingIndex, setExplainingIndex] = useState(null);
  const [aiExplanation, setAiExplanation] = useState(null);

  useEffect(() => {
    fetchData();
  }, [batchId]);

  const fetchData = async () => {
    try {
      const res = await batchesApi.getWorkbook(batchId);
      const workbook = res.data.workbook || {};
      
      const normalizedData = {};
      SHEETS.forEach(sheet => {
        if (sheet.name === 'Config') {
          const configObj = workbook.config || {};
          const configRows = Object.entries(configObj).map(([key, value]) => ({
            key,
            value: value === null || value === undefined ? '' : String(value)
          }));
          normalizedData['Config'] = configRows;
        } else {
          normalizedData[sheet.name] = workbook[sheet.workbookKey] || [];
        }
      });
      
      setData(normalizedData);
    } catch (err) {
      toast.error('Failed to load workbook data.');
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const addRow = (sheetName) => {
    setData(prev => {
      const sheetInfo = SHEETS.find(s => s.name === sheetName);
      const newRow = {};
      sheetInfo.cols.forEach(col => newRow[col] = '');
      return { ...prev, [sheetName]: [...(prev[sheetName] || []), newRow] };
    });
  };

  const removeRow = (sheetName, rowIndex) => {
    setData(prev => {
      const sheetData = [...(prev[sheetName] || [])];
      sheetData.splice(rowIndex, 1);
      return { ...prev, [sheetName]: sheetData };
    });
  };

  const removeSelectedRow = () => {
    if (activeCell && activeCell.row !== undefined && activeCell.row !== null) {
      const rowIndex = activeCell.row;
      if (rowIndex >= 0 && rowIndex < currentSheetData.length) {
        removeRow(activeSheet, rowIndex);
        setActiveCell(null);
        toast.success(`Removed row ${rowIndex + 1}`);
      } else {
        toast.error("Invalid row index selected.");
      }
    } else {
      toast.error("Please click on a cell to select a row to delete.");
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setValidationErrors([]);
    setAiExplanation(null);
    const toastId = toast.loading('Saving and validating changes...');
    try {
      const workbookToSave = {};
      SHEETS.forEach(sheet => {
        if (sheet.name === 'Config') {
          const configObj = {};
          (data['Config'] || []).forEach(row => {
            if (row.key && String(row.key).trim()) {
              configObj[String(row.key).trim()] = row.value;
            }
          });
          workbookToSave['config'] = configObj;
        } else {
          workbookToSave[sheet.workbookKey] = data[sheet.name] || [];
        }
      });

      await batchesApi.updateWorkbook(batchId, workbookToSave);
      toast.success('Workbook saved and validated successfully!', { id: toastId });
      if (onSaveSuccess) onSaveSuccess();
      onClose();
    } catch (err) {
      if (err.errors) {
        setValidationErrors(err.errors);
        toast.error(`Validation failed: ${err.errors.length} issue(s) found.`, { id: toastId });
      } else {
        const msg = err.message || 'Failed to save changes';
        toast.error(msg, { id: toastId });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSheetChange = (sheetName) => {
    setActiveSheet(sheetName);
    setValidationErrors([]);
    setActiveCell(null);
    setAiExplanation(null);
  };

  const handleExplainError = async (issue, index) => {
    setExplainingIndex(index);
    setAiExplanation(null);
    try {
      const result = await explainApi.explainValidatorError(batchId, {
        rule: issue.rule || issue.code || null,
        severity: issue.severity || 'error',
        message: issue.message,
        sheet: issue.sheet || null,
        row: issue.row || null,
        column: issue.column || null,
        value: issue.value || null
      });
      setAiExplanation({
        index,
        explanation: result.explanation,
        board_suggestion: result.board_suggestion
      });
    } catch (err) {
      toast.error(err.message || 'Failed to get AI explanation.');
    } finally {
      setExplainingIndex(null);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-white animate-spin" />
      </div>
    );
  }

  const currentSheetCols = SHEETS.find(s => s.name === activeSheet).cols;
  const currentSheetData = data[activeSheet] || [];

  // Convert our list-of-objects to cell-matrix [[{ value: '' }]] for react-spreadsheet
  const matrixData = currentSheetData.map(row => 
    currentSheetCols.map(col => ({
      value: row[col] === null || row[col] === undefined ? '' : String(row[col])
    }))
  );

  const handleSpreadsheetChange = (newMatrix) => {
    const newSheetData = newMatrix.map((rowArr) => {
      const rowObj = {};
      currentSheetCols.forEach((col, colIdx) => {
        const cell = rowArr[colIdx];
        rowObj[col] = cell ? (cell.value === null || cell.value === undefined ? '' : String(cell.value)) : '';
      });
      return rowObj;
    });
    setData(prev => ({ ...prev, [activeSheet]: newSheetData }));
  };

  return (
    <div className="fixed inset-0 bg-slate-900/55 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50 shrink-0">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Edit Workbook: {batchName || 'Routine'}</h2>
            <p className="text-xs text-slate-500">Batch ID: #{batchId} &bull; Double click cells to edit. Use arrow keys to navigate.</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 bg-sky-600 hover:bg-sky-700 text-white px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save &amp; Validate
            </button>
            <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-lg transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Warnings & Validation Errors */}
        {validationErrors.length > 0 && (
          <div className="bg-red-50 border-b border-red-200 px-6 py-3 max-h-64 overflow-y-auto shrink-0">
            <h4 className="text-xs font-bold text-red-800 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 text-red-600" />
              Validation Error(s) Preventing Save:
            </h4>
            <div className="space-y-3">
              {validationErrors.map((e, idx) => (
                <div key={idx} className="border-l-2 border-red-300 pl-3 py-0.5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="text-xs text-red-700 font-mono leading-relaxed">
                      <strong className="bg-red-100 px-1 py-0.2 rounded text-red-800 mr-1.5">{e.sheet || 'General'}</strong>
                      {e.row ? `(row ${e.row})` : ''}
                      {e.column ? ` [col ${e.column}]` : ''}: {e.message}
                    </div>
                    <button
                      onClick={() => handleExplainError(e, idx)}
                      disabled={explainingIndex !== null}
                      className="flex items-center gap-1 text-[11px] font-semibold text-indigo-700 hover:text-indigo-900 bg-indigo-50 hover:bg-indigo-100 px-2 py-0.5 rounded transition-colors shrink-0 disabled:opacity-50"
                    >
                      {explainingIndex === idx ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                          Consulting AI...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                          Ask AI to Solve
                        </>
                      )}
                    </button>
                  </div>
                  
                  {/* AI Explanation Details */}
                  {aiExplanation && aiExplanation.index === idx && (
                    <div className="mt-2 bg-linear-to-r from-sky-50 to-indigo-50 border border-sky-200 rounded-lg p-3 text-xs text-slate-700 shadow-xs animate-in slide-in-from-top-1 duration-200">
                      <div className="flex items-center gap-1.5 font-bold text-sky-800 mb-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-sky-600 animate-pulse" />
                        AI Solution Assistant
                      </div>
                      <p className="leading-relaxed mb-2 text-slate-800 font-sans">{aiExplanation.explanation}</p>
                      {aiExplanation.board_suggestion && (
                        <div className="bg-white/90 border border-sky-100 rounded p-2 font-mono text-[10px] text-indigo-700 flex items-start gap-1">
                          <span className="font-bold shrink-0 text-sky-700">💡 Excel Action:</span>
                          <span className="leading-normal">{aiExplanation.board_suggestion}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="bg-amber-50 border-b border-amber-100 px-6 py-2 flex items-center gap-2 text-xs text-amber-700 shrink-0">
          <AlertCircle className="w-4 h-4" />
          Always make sure referenced abbreviation codes (teachers, courses, rooms, types) match exactly.
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 overflow-x-auto bg-white px-4 pt-2 shrink-0">
          {SHEETS.map(sheet => (
            <button
              key={sheet.name}
              onClick={() => handleSheetChange(sheet.name)}
              className={`px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                activeSheet === sheet.name
                  ? 'border-sky-600 text-sky-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
              }`}
            >
              {sheet.name}
              <span className="ml-2 text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">
                {(data[sheet.name] || []).length}
              </span>
            </button>
          ))}
        </div>

        {/* Grid Editor */}
        <div className="flex-1 overflow-auto bg-slate-50 p-6 flex flex-col">
          <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm p-4 overflow-auto max-h-[50vh]">
            {currentSheetData.length === 0 ? (
              <div className="p-8 text-center text-slate-400 bg-white border border-dashed border-slate-200 rounded-xl">
                No rows in this sheet. Click "Add Row" below to insert one.
              </div>
            ) : (
              <div className="overflow-auto min-w-full font-sans text-xs">
                <Spreadsheet
                  data={matrixData}
                  columnLabels={currentSheetCols}
                  onActivate={setActiveCell}
                  onChange={handleSpreadsheetChange}
                />
              </div>
            )}
          </div>
          
          <div className="mt-4 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <button
                onClick={() => addRow(activeSheet)}
                className="flex items-center gap-2 text-xs font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 px-4 py-2 rounded-lg transition-colors border border-sky-100"
              >
                <Plus className="w-4 h-4" />
                Add Row
              </button>
              
              <button
                onClick={removeSelectedRow}
                disabled={!activeCell}
                className="flex items-center gap-2 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 px-4 py-2 rounded-lg transition-colors border border-red-100 disabled:opacity-40 disabled:hover:bg-red-50"
                title={activeCell ? `Delete row ${activeCell.row + 1}` : 'Select a cell first to delete its row'}
              >
                <Trash2 className="w-4 h-4" />
                Delete Selected Row {activeCell ? `(${activeCell.row + 1})` : ''}
              </button>
            </div>
            
            {activeCell && (
              <div className="text-xs text-slate-500 font-mono bg-slate-100 px-2.5 py-1 rounded">
                Active cell: row <span className="font-bold text-slate-700">{activeCell.row + 1}</span>, col <span className="font-bold text-slate-700">{currentSheetCols[activeCell.column]}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SpreadsheetEditor;


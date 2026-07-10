import React, { useState, useEffect } from 'react';
import { batchesApi } from '../api/client';
import { X, Save, Plus, Trash2, Loader2, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';

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

  const handleCellChange = (sheetName, rowIndex, colName, value) => {
    setData(prev => {
      const sheetData = [...(prev[sheetName] || [])];
      sheetData[rowIndex] = { ...sheetData[rowIndex], [colName]: value };
      return { ...prev, [sheetName]: sheetData };
    });
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

  const handleSave = async () => {
    setSaving(true);
    setValidationErrors([]);
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

  if (loading) {
    return (
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-white animate-spin" />
      </div>
    );
  }

  const currentSheetCols = SHEETS.find(s => s.name === activeSheet).cols;
  const currentSheetData = data[activeSheet] || [];

  return (
    <div className="fixed inset-0 bg-slate-900/55 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Edit Workbook: {batchName || 'Routine'}</h2>
            <p className="text-xs text-slate-500">Batch ID: #{batchId} &bull; Adjust config and sheet rows in the tables below</p>
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
          <div className="bg-red-50 border-b border-red-200 px-6 py-3 max-h-36 overflow-y-auto">
            <h4 className="text-xs font-bold text-red-800 uppercase tracking-wider mb-1 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 text-red-600" />
              Validation Error(s) Preventing Save:
            </h4>
            <ul className="list-disc list-inside text-xs text-red-700 space-y-0.5 font-mono">
              {validationErrors.map((e, idx) => (
                <li key={idx}>
                  <strong>{e.sheet || 'General'}</strong>
                  {e.row ? ` (row ${e.row})` : ''}
                  {e.column ? ` [col ${e.column}]` : ''}: {e.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="bg-amber-50 border-b border-amber-100 px-6 py-2 flex items-center gap-2 text-xs text-amber-700">
          <AlertCircle className="w-4 h-4" />
          Always make sure referenced abbreviation codes (teachers, courses, rooms, types) match exactly.
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 overflow-x-auto bg-white px-4 pt-2 shrink-0">
          {SHEETS.map(sheet => (
            <button
              key={sheet.name}
              onClick={() => {
                setActiveSheet(sheet.name);
                setValidationErrors([]);
              }}
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
        <div className="flex-1 overflow-auto bg-slate-50 p-6">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden min-w-full">
            <div className="overflow-x-auto max-h-[50vh]">
              <table className="w-full text-left text-sm whitespace-nowrap table-fixed">
                <thead className="bg-slate-100 text-slate-600 sticky top-0 z-10">
                  <tr>
                    <th className="px-4 py-3 font-semibold w-12 text-center bg-slate-100">#</th>
                    {currentSheetCols.map(col => (
                      <th key={col} className="px-4 py-3 font-semibold border-l border-slate-200 bg-slate-100">
                        {col}
                      </th>
                    ))}
                    <th className="px-4 py-3 font-semibold border-l border-slate-200 w-16 text-center bg-slate-100">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {currentSheetData.length === 0 ? (
                    <tr>
                      <td colSpan={currentSheetCols.length + 2} className="px-4 py-8 text-center text-slate-400">
                        No rows in this sheet. Click "Add Row" below to insert one.
                      </td>
                    </tr>
                  ) : (
                    currentSheetData.map((row, rowIndex) => (
                      <tr key={rowIndex} className="hover:bg-slate-50/50 group">
                        <td className="px-4 py-2 text-center text-slate-400 text-xs bg-slate-50/40">{rowIndex + 1}</td>
                        {currentSheetCols.map(col => (
                          <td key={col} className="p-0 border-l border-slate-100 relative">
                            <input
                              type="text"
                              value={row[col] === null || row[col] === undefined ? '' : row[col]}
                              onChange={(e) => handleCellChange(activeSheet, rowIndex, col, e.target.value)}
                              className="w-full px-3 py-2 bg-transparent focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-inset focus:ring-sky-500 text-slate-700 text-xs"
                              placeholder={`Enter ${col}`}
                            />
                          </td>
                        ))}
                        <td className="px-4 py-2 border-l border-slate-100 text-center">
                          <button
                            onClick={() => removeRow(activeSheet, rowIndex)}
                            className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-sm transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                            title="Remove row"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          
          <button
            onClick={() => addRow(activeSheet)}
            className="mt-4 flex items-center gap-2 text-sm font-medium text-sky-700 bg-sky-50 hover:bg-sky-100 px-4 py-2 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Row
          </button>
        </div>
      </div>
    </div>
  );
};

export default SpreadsheetEditor;

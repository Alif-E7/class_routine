import React, { useState, useEffect } from 'react';
import { masterApi } from '../api/client';
import { X, Save, Plus, Trash2, Loader2, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';

const SHEETS = [
  { name: 'Departments', cols: ['dept_code', 'dept_name', 'faculty'] },
  { name: 'Teachers', cols: ['teacher_code', 'teacher_name', 'dept_code', 'designation'] },
  { name: 'Rooms', cols: ['room_no', 'building'] },
  { name: 'Courses', cols: ['course_code', 'course_name', 'credit', 'dept_code'] },
  { name: 'Sections', cols: ['dept_code', 'year', 'semester'] },
  { name: 'TimeSlots', cols: ['start_time', 'end_time'] },
  { name: 'RoutineEntries', cols: ['day', 'dept_code', 'year', 'semester', 'course_code', 'teacher_code', 'room_no', 'start_time', 'end_time'] }
];

const SpreadsheetEditor = ({ semesterId, deptCode, semesterName, onClose }) => {
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeSheet, setActiveSheet] = useState(SHEETS[0].name);

  useEffect(() => {
    fetchData();
  }, [semesterId, deptCode]);

  const fetchData = async () => {
    try {
      const res = await masterApi.getDepartmentRoutineData(semesterId, deptCode);
      
      const normalizedData = {};
      SHEETS.forEach(sheet => {
        normalizedData[sheet.name] = res.data.data[sheet.name] || [];
      });
      
      setData(normalizedData);
    } catch (err) {
      toast.error('Failed to load routine data.');
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const handleCellChange = (sheetName, rowIndex, colName, value) => {
    setData(prev => {
      const sheetData = [...prev[sheetName]];
      sheetData[rowIndex] = { ...sheetData[rowIndex], [colName]: value };
      return { ...prev, [sheetName]: sheetData };
    });
  };

  const addRow = (sheetName) => {
    setData(prev => {
      const sheetInfo = SHEETS.find(s => s.name === sheetName);
      const newRow = {};
      sheetInfo.cols.forEach(col => newRow[col] = '');
      return { ...prev, [sheetName]: [...prev[sheetName], newRow] };
    });
  };

  const removeRow = (sheetName, rowIndex) => {
    setData(prev => {
      const sheetData = [...prev[sheetName]];
      sheetData.splice(rowIndex, 1);
      return { ...prev, [sheetName]: sheetData };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    const id = toast.loading('Saving changes...');
    try {
      await masterApi.updateDepartmentRoutineData(semesterId, deptCode, data);
      toast.success('Routine updated successfully!', { id });
      onClose();
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to save changes';
      toast.error(msg, { id });
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
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Editing {deptCode} Routine</h2>
            <p className="text-sm text-slate-500">{semesterName}</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 bg-ocean-600 hover:bg-ocean-700 text-white px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Changes
            </button>
            <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-lg transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Warning */}
        <div className="bg-amber-50 border-b border-amber-100 px-6 py-2 flex items-center gap-2 text-xs text-amber-700">
          <AlertCircle className="w-4 h-4" />
          Make sure your references (like teacher_code or course_code) exactly match those defined in the other sheets!
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 overflow-x-auto bg-white px-4 pt-2">
          {SHEETS.map(sheet => (
            <button
              key={sheet.name}
              onClick={() => setActiveSheet(sheet.name)}
              className={`px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                activeSheet === sheet.name
                  ? 'border-ocean-600 text-ocean-700'
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
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-100 text-slate-600">
                  <tr>
                    <th className="px-4 py-3 font-semibold w-10 text-center">#</th>
                    {currentSheetCols.map(col => (
                      <th key={col} className="px-4 py-3 font-semibold border-l border-slate-200">
                        {col}
                      </th>
                    ))}
                    <th className="px-4 py-3 font-semibold border-l border-slate-200 w-16">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {currentSheetData.length === 0 ? (
                    <tr>
                      <td colSpan={currentSheetCols.length + 2} className="px-4 py-8 text-center text-slate-400">
                        No rows in this sheet.
                      </td>
                    </tr>
                  ) : (
                    currentSheetData.map((row, rowIndex) => (
                      <tr key={rowIndex} className="hover:bg-slate-50/50 group">
                        <td className="px-4 py-2 text-center text-slate-400 text-xs">{rowIndex + 1}</td>
                        {currentSheetCols.map(col => (
                          <td key={col} className="p-0 border-l border-slate-100 relative">
                            <input
                              type="text"
                              value={row[col] === null || row[col] === undefined ? '' : row[col]}
                              onChange={(e) => handleCellChange(activeSheet, rowIndex, col, e.target.value)}
                              className="w-full px-4 py-3 bg-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-inset focus:ring-ocean-500 text-slate-700"
                              placeholder={`Enter ${col}`}
                            />
                          </td>
                        ))}
                        <td className="px-4 py-2 border-l border-slate-100 text-center">
                          <button
                            onClick={() => removeRow(activeSheet, rowIndex)}
                            className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                            title="Remove row"
                          >
                            <Trash2 className="w-4 h-4" />
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
            className="mt-4 flex items-center gap-2 text-sm font-medium text-ocean-600 bg-ocean-50 hover:bg-ocean-100 px-4 py-2 rounded-lg transition-colors"
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

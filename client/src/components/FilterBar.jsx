import { useState, useEffect, useMemo } from 'react';
import { masterApi } from '../api/client';

// Filter selections are flat — semester / department / year / semester-term.
// "year" ∈ 1..4 (the academic year), "semester" ∈ 1..2 (odd/even term of that year).
const FilterBar = ({ onFilterChange }) => {
  const [semesters, setSemesters] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [sections, setSections] = useState([]);

  const [filters, setFilters] = useState({
    semesterId: '',
    department: '',
    year: '',
    semester: ''
  });

  useEffect(() => {
    fetchSemesters();
  }, []);

  useEffect(() => {
    if (filters.semesterId) {
      fetchDepartments(filters.semesterId);
    }
  }, [filters.semesterId]);

  useEffect(() => {
    if (filters.semesterId && filters.department) {
      fetchSections(filters.semesterId, filters.department);
    }
  }, [filters.semesterId, filters.department]);

  const fetchSemesters = async () => {
    try {
      const res = await masterApi.getSemesters();
      setSemesters(res.data.data);
      if (res.data.data.length > 0) {
        handleChange('semesterId', res.data.data[0].id);
      }
    } catch (e) { console.error(e); }
  };

  const fetchDepartments = async (semesterId) => {
    try {
      const res = await masterApi.getDepartments({ semesterId });
      setDepartments(res.data.data);
    } catch (e) { console.error(e); }
  };

  const fetchSections = async (semesterId, department) => {
    try {
      const res = await masterApi.getSections({ semesterId, department });
      setSections(res.data.data);
    } catch (e) { console.error(e); }
  };

  const handleChange = (name, value) => {
    const newFilters = { ...filters, [name]: value };
    // Reset dependents so stale filters don't leak across department changes
    if (name === 'semesterId') {
      newFilters.department = '';
      newFilters.year = '';
      newFilters.semester = '';
    } else if (name === 'department') {
      newFilters.year = '';
      newFilters.semester = '';
    } else if (name === 'year') {
      newFilters.semester = '';
    }
    setFilters(newFilters);
    onFilterChange(newFilters);
  };

  // Distinct year values present for the chosen department
  const availableYears = useMemo(() => {
    const years = new Set(sections.map(s => Number(s.year)).filter(Boolean));
    return Array.from(years).sort((a, b) => a - b);
  }, [sections]);

  // Distinct semester values present for the chosen year
  const availableSemesters = useMemo(() => {
    if (!filters.year) return [];
    const sm = new Set(
      sections
        .filter(s => Number(s.year) === Number(filters.year))
        .map(s => Number(s.semester))
        .filter(Boolean)
    );
    return Array.from(sm).sort((a, b) => a - b);
  }, [sections, filters.year]);

  return (
    <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-wrap gap-4 items-end mb-6">
      <div className="flex-1 min-w-[200px]">
        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Semester</label>
        <select
          className="w-full p-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
          value={filters.semesterId}
          onChange={(e) => handleChange('semesterId', e.target.value)}
        >
          {semesters.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      <div className="flex-1 min-w-[150px]">
        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Department</label>
        <select
          className="w-full p-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
          value={filters.department}
          onChange={(e) => handleChange('department', e.target.value)}
          disabled={!filters.semesterId}
        >
          <option value="">All Departments</option>
          {departments.map(d => <option key={d.id} value={d.deptCode}>{d.deptCode} - {d.deptName}</option>)}
        </select>
      </div>

      <div className="w-32">
        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Year</label>
        <select
          className="w-full p-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
          value={filters.year}
          onChange={(e) => handleChange('year', e.target.value)}
          disabled={!filters.department || availableYears.length === 0}
        >
          <option value="">All</option>
          {availableYears.map(y => <option key={y} value={y}>Year {y}</option>)}
        </select>
      </div>

      <div className="w-40">
        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Term</label>
        <select
          className="w-full p-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
          value={filters.semester}
          onChange={(e) => handleChange('semester', e.target.value)}
          disabled={!filters.year || availableSemesters.length === 0}
        >
          <option value="">All</option>
          {availableSemesters.map(sm => (
            <option key={sm} value={sm}>{sm === 1 ? 'Odd Term' : 'Even Term'}</option>
          ))}
        </select>
      </div>
    </div>
  );
};

export default FilterBar;

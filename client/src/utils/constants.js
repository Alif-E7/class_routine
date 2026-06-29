export const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THR'];

// 50-minute class slots matching the university routine image, with a lunch break between 13:10 and 14:00
export const TIME_SLOTS = [
  { start: '09:00', end: '09:50', label: '9:00-9:50am' },
  { start: '09:50', end: '10:40', label: '9:50-10:40am' },
  { start: '10:40', end: '11:30', label: '10:40-11:30am' },
  { start: '11:30', end: '12:20', label: '11:30-12:20pm' },
  { start: '12:20', end: '13:10', label: '12:20-1:10pm\n(For Lab 12:20-2:00pm)' },
  { start: '14:00', end: '15:00', label: '2:00-3:00pm' },
  { start: '15:00', end: '16:00', label: '3:00-3:50pm' }
];

// The break column is inserted AFTER this index (after 12:20-1:10pm)
export const BREAK_AFTER_INDEX = 4;

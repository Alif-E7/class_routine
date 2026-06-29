// Quick smoke test for pdf.service
const fs = require('fs');
const path = require('path');
const { Writable } = require('stream');
const { streamDepartmentRoutinePdf } = require('../src/services/pdf.service');

const OUT = path.join(__dirname, '..', 'test-pdf-output.pdf');
if (fs.existsSync(OUT)) fs.unlinkSync(OUT);

const fakeRes = new Writable({
  write(chunk, enc, cb) {
    fs.appendFileSync(OUT, chunk);
    cb();
  },
});
fakeRes.setHeader = () => {};

const sample = [
  { day: 'SUN', section: { deptCode: 'CSE', year: 1, semester: 1 }, course: { courseCode: 'CSE101' }, teacher: { teacherCode: 'T01', teacherName: 'Dr. Smith', designation: 'Professor' }, room: { roomNo: '301' }, timeSlot: { startTime: '09:00', endTime: '09:50' } },
  { day: 'SUN', section: { deptCode: 'CSE', year: 1, semester: 1 }, course: { courseCode: 'CSE102' }, teacher: { teacherCode: 'T02', teacherName: 'Ms. Khan', designation: 'Lecturer' }, room: { roomNo: '302' }, timeSlot: { startTime: '11:30', endTime: '12:20' } },
  { day: 'MON', section: { deptCode: 'CSE', year: 1, semester: 2 }, course: { courseCode: 'CSE201' }, teacher: { teacherCode: 'T03', teacherName: 'Mr. Roy', designation: 'Asst. Prof.' }, room: { roomNo: '201' }, timeSlot: { startTime: '15:00', endTime: '16:00' } },
  { day: 'WED', section: { deptCode: 'CSE', year: 1, semester: 1 }, course: { courseCode: 'CSE103' }, teacher: { teacherCode: 'T01', teacherName: 'Dr. Smith', designation: 'Professor' }, room: { roomNo: '304' }, timeSlot: { startTime: '10:40', endTime: '11:30' } },
];

streamDepartmentRoutinePdf(fakeRes, {
  entries: sample,
  departmentName: 'Computer Science & Engineering',
  semesterName: 'January-June 2026',
});

setTimeout(() => {
  const stat = fs.statSync(OUT);
  const head = fs.readFileSync(OUT).slice(0, 5).toString();
  console.log(`PDF size: ${stat.size} bytes`);
  console.log(`PDF header: ${head}`);
  console.log(stat.size > 1000 && head.startsWith('%PDF-') ? 'OK — valid PDF' : 'FAIL');
  fs.unlinkSync(OUT);
  process.exit(0);
}, 1500);
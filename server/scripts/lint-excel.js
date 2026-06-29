// CLI wrapper for the Excel pre-flight linter.
//
// Usage:
//   node scripts/lint-excel.js <path-to.xlsx> --dept CSE [--semester "January-July 2025"] [--json]
//
// Exit codes:
//   0  no errors (warnings allowed)
//   1  one or more errors
//   2  bad usage / file not found

const path = require('path');
const fs = require('fs');
const { parseWorkbook } = require('../src/services/excel.service');
const { lintWorkbook } = require('../src/services/lint.service');

const COLORS = {
  reset: '\x1b[0m',
  red:   '\x1b[31m',
  green: '\x1b[32m',
  yellow:'\x1b[33m',
  cyan:  '\x1b[36m',
  bold:  '\x1b[1m',
  dim:   '\x1b[2m'
};
const useColor = process.stdout.isTTY;

const color = (c, s) => useColor ? `${COLORS[c]}${s}${COLORS.reset}` : s;

const parseArgs = (argv) => {
  const args = { file: null, dept: null, semester: null, json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dept' || a === '-d') args.dept = argv[++i];
    else if (a === '--semester' || a === '-s') args.semester = argv[++i];
    else if (a === '--json') args.json = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (!args.file) args.file = a;
  }
  return args;
};

const printHelp = () => {
  console.log(`Usage: node scripts/lint-excel.js <path-to.xlsx> --dept CSE [options]

Options:
  -d, --dept CODE         Department code from the upload form (e.g. CSE)
  -s, --semester NAME     Semester name (informational only)
      --json              Output machine-readable JSON
  -h, --help              Show this help

Exit codes:
  0  no errors (warnings allowed)
  1  one or more errors
  2  bad usage / file not found`);
};

(async () => {
  const args = parseArgs(process.argv);
  if (args.help || !args.file) {
    printHelp();
    process.exit(args.help ? 0 : 2);
  }

  const filePath = path.resolve(args.file);
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(2);
  }
  if (!args.dept) {
    console.error('Missing required --dept CODE');
    printHelp();
    process.exit(2);
  }

  let data;
  try {
    data = await parseWorkbook(filePath);
  } catch (err) {
    console.error(`Failed to parse workbook: ${err.message}`);
    process.exit(1);
  }

  const result = lintWorkbook(data, { departmentCode: args.dept });

  if (args.json) {
    console.log(JSON.stringify({
      file: filePath,
      departmentCode: args.dept,
      semester: args.semester,
      ...result
    }, null, 2));
    process.exit(result.isValid ? 0 : 1);
  }

  // Human-friendly output
  console.log(color('bold', `\n  Excel Pre-flight Lint`));
  console.log(color('dim', `  File:        ${filePath}`));
  console.log(color('dim', `  Department:  ${args.dept}`));
  if (args.semester) console.log(color('dim', `  Semester:    ${args.semester}`));
  console.log();

  const ruleNames = {
    R1: 'RoutineEntries sheet structure',
    R2: 'Canonical columns present',
    R3: 'dept_code handling',
    R4: 'Day values',
    R5: 'Year values',
    R6: 'Semester values',
    R7: 'Time format',
    R8: 'Master references exist',
    R9: 'No double-booking',
    R10:'Faculty values'
  };

  const printList = (title, list, color_) => {
    if (list.length === 0) {
      console.log(color('green', `  ✓ ${title}: none`));
      return;
    }
    console.log(color(color_, `  ${title}: ${list.length}`));
    list.forEach((v) => {
      const loc = v.sheet + (v.row ? ` row ${v.row}` : '') + (v.column ? ` (${v.column})` : '');
      console.log(`    ${color('bold', v.rule.padEnd(4))} ${color('dim', loc)}`);
      console.log(`        ${v.message}`);
    });
  };

  printList('Errors',   result.errors,   'red');
  printList('Warnings', result.warnings, 'yellow');

  console.log();
  console.log(color('bold', '  Summary'));
  console.log(`    Errors:   ${color(result.errors.length ? 'red' : 'green', result.errors.length)}`);
  console.log(`    Warnings: ${color(result.warnings.length ? 'yellow' : 'green', result.warnings.length)}`);
  console.log(`    By rule:  ${Object.entries(result.summary.byRule).map(([k,v]) => `${k}=${v}`).join(', ') || 'none'}`);
  console.log();

  if (result.isValid) {
    console.log(color('green', '  ✓ PASS — file is safe to upload.'));
    process.exit(0);
  } else {
    console.log(color('red', `  ✗ FAIL — ${result.errors.length} error(s) must be fixed before upload.`));
    process.exit(1);
  }
})().catch((err) => {
  console.error('Lint crashed:', err);
  process.exit(1);
});
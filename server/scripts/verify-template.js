// Read back the generated template.xlsx and print every sheet's headers + rows.
const ExcelJS = require('exceljs');

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(process.argv[2] || './Routine_Template.xlsx');
  wb.eachSheet((sheet) => {
    console.log(`\n=== Sheet: ${sheet.name} ===`);
    const headerRow = sheet.getRow(1);
    const headers = [];
    headerRow.eachCell({ includeEmpty: false }, (cell) => headers.push(String(cell.value)));
    console.log(`Columns (${headers.length}): ${headers.join(' | ')}`);
    console.log(`Rows: ${sheet.rowCount - 1}`);
    for (let r = 2; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const cells = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        const v = cell.value;
        cells.push(v === null || v === undefined ? '' : String(v));
      });
      console.log(`  ${r - 1}: ${cells.join(' | ')}`);
    }
  });
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
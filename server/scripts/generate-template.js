// CLI helper that invokes the same template builder used by the /api/template/download
// endpoint and writes the result to disk. Useful for regenerating the bundled
// template.xlsx without running the full server.
//
// Usage:  node scripts/generate-template.js [outputPath]
const path = require('path');
const fs = require('fs');
const { buildTemplate } = require('../src/controllers/template.controller');

(async () => {
  const outPath = process.argv[2] || path.join(__dirname, '..', 'Routine_Template.xlsx');
  const buf = await buildTemplate();
  fs.writeFileSync(outPath, Buffer.from(buf));
  console.log(`Template written to ${outPath}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
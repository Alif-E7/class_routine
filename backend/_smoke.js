const http = require('http');
const fs = require('fs');
const FormData = require('form-data');
const fd = new FormData();
fd.append('file', fs.createReadStream('_valid.xlsx'), { filename: 'CVL_Routine_Filled.xlsx' });
fd.append('semester', '2026, January-July');
const req = http.request({ host: 'localhost', port: 4000, path: '/api/upload', method: 'POST', headers: fd.getHeaders() }, (res) => {
  let body = '';
  res.on('data', (d) => body += d);
  res.on('end', () => {
    console.log('STATUS', res.statusCode);
    console.log('BODY', body);
  });
});
fd.pipe(req);
req.on('error', (e) => console.log('REQ ERROR', e.message));
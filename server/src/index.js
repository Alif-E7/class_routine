require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const errorHandler = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Routes
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/upload-routine', require('./routes/upload.routes'));
app.use('/api/departments', require('./routes/department.routes'));
app.use('/api/routine', require('./routes/routine.routes'));
app.use('/api/semesters', require('./routes/semester.routes'));

// Template download
const templateController = require('./controllers/template.controller');
app.get('/api/template/download', templateController.downloadTemplate);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'API is running' });
});

// Error handling
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

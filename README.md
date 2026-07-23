# 📅 CSE Routine Generator

A smart, automated tool that helps university departments generate collision-free weekly class schedules. Just upload an Excel file with your teachers, rooms, and courses, and the system will automatically handle the complex math to build a perfect routine in seconds!

---

## ✨ Key Features

- **📂 Simple Excel Upload**: Upload your department's Excel file containing course credits, teacher names, and room lists.
- **⚡ Smart Automatic Scheduling**: Uses an advanced mathematical algorithm (backtracking with bin-packing constraints and rapid randomized restarts) to instantly build a collision-free schedule.
- **🖥️ Interactive Timetable Grid**: View and manage the generated routine in a clean, modern interactive interface.
- **🤖 Built-in AI Assistant**: If a schedule can't be created (e.g., if teachers are overbooked), an AI assistant will tell you exactly what to change in your Excel sheet to fix it.
- **📄 Export to PDF**: Save your finalized schedule as a clean, publication-ready PDF document.

---

## 🚀 How it Works (Under the Hood)

Creating a university timetable is like solving a giant puzzle. The system ensures:
1. **No double-bookings**: No teacher or classroom is scheduled for two classes at once.
2. **Classroom matching**: Standard classes go to regular lecture halls, while labs are scheduled in specialized computer labs.
3. **Morning/Afternoon placement**: Long lab classes (e.g., 3-hour classes) are automatically fitted into morning slots using smart bin-packing logic.
4. **Fast recovery**: If the solver gets stuck in a tricky dead end, it automatically restarts with a fresh perspective (Rapid Restarts) to find a working schedule in milliseconds.

---

## 🛠️ Local Setup Guide

Follow these steps to run the project on your computer.

### 1. Prerequisites
- **Node.js** (v18 or higher)
- **MySQL Server**
- **LibreOffice** (needed to generate and download PDFs)

### 2. Database Setup
Create a MySQL database named `routine_generator` and run the migrations:
```bash
cd backend
npm install
npm run migrate
```
*Note: This creates all required tables and seeds the default administrator account.*

### 3. Environment Variables
Create a file named `.env` inside the `backend/` folder and paste the following:
```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=YourMySQLPassword
DB_NAME=routine_generator

PORT=4000
SCHEDULER_BUDGET=2000000

# Optional: Add your Groq/Gemini key for AI advice
GROQ_API_KEY=your_api_key_here
GROQ_MODEL=llama-3.3-70b-versatile
GROQ_BASE_URL=https://api.groq.com/openai/v1
GROQ_TIMEOUT_MS=6000
```

### 4. Running the Project
You need to start both the backend server and the frontend interface. Open two terminal windows:

**Terminal 1: Start Backend (Port 4000)**
```bash
cd backend
npm run dev
```

**Terminal 2: Start Frontend (Vite on Port 5173)**
```bash
cd client
npm install
npm run dev
```

---


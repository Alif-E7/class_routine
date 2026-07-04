# Gopalganj Science & Technology University — Class Routine

A full-stack web app that lets an administrator upload an Excel-based class routine
and renders it as a polished, printable weekly timetable on the homepage.

## Tech stack
- **Frontend:** React 19 + Vite + Tailwind CSS 4 + lucide-react
- **Backend:** Node.js + Express + Prisma (PostgreSQL)
- **PDF Export:** `libreoffice --headless --convert-to pdf` (DOCX is generated via the `docx` library and converted server-side)
- **Container:** Docker + docker-compose

> **Note:** PDF export requires [LibreOffice](https://www.libreoffice.org/) installed on the backend host (the
> container's `Dockerfile.server` adds it). If LibreOffice is missing, the `/api/batches/:id/export.pdf` endpoint
> returns `501 PDF_UNAVAILABLE`; the `.docx` endpoint still works without it.

## AI assist (optional)

The backend ships a thin wrapper (`backend/src/services/aiProvider.js`) around the Google Gemini API. It powers two features:

1. **Friendly failure hints** — when the CSP scheduler reports infeasibility, the `/generate` failure handler enriches the response with a short admin-facing paragraph explaining likely causes (room shortage, teacher unavailability, classes-per-week > slots, etc.).
2. **Ask AI to draft an edit** — `POST /api/batches/:id/edit` takes a free-text prompt like `"please move CSE406 from Sunday 9am to Monday 10am"` and returns a structured proposal `{kind, summary, change?, question?, concerns[]}` that the admin UI can show before the admin confirms any actual change. This endpoint is **advisory only** — it never mutates the schedule; applying the proposal would require a separate admin-only `/apply` endpoint (out of scope for Step 8).

Both features are **opt-in**. The core scheduler does not depend on AI; if `GEMINI_API_KEY` is empty, both features degrade gracefully (the failure endpoint returns the structured error unchanged, and `/edit` returns `503 AI_UNAVAILABLE`).

### Environment variables

Set these in `backend/.env` (gitignored — never commit your real key):

```bash
GEMINI_API_KEY=                # leave blank to disable AI assist entirely
GEMINI_MODEL=gemini-2.5-flash  # default model
GEMINI_ENDPOINT=https://generativelanguage.googleapis.com/v1beta/models
GEMINI_TIMEOUT_MS=6000         # per-call timeout
```

To enable AI assist locally, paste your Gemini API key into `backend/.env` (`GEMINI_API_KEY=...`). The `.env.example` file in `backend/` ships placeholders only — the real key stays in `.env` which is `.gitignore`d.

## Project structure
```
.
├── client/                # React + Vite frontend
│   └── src/
│       ├── components/    # TimetableGrid, FilterBar, FileUpload, TopNav, Layout
│       ├── pages/         # Homepage, Dashboard, RoutineView
│       ├── api/           # axios client (routines, masters, template)
│       └── utils/         # constants (DAYS, TIME_SLOTS), colors
├── server/                # Express API
│   ├── prisma/            # schema + seed
│   └── src/
│       ├── controllers/   # routine, department, semester, upload, template
│       ├── routes/
│       ├── services/      # excel, import, routine, validation
│       └── middleware/
└── docker-compose.yml
```

## Excel import format (REQUIRED)

The admin uploads one `.xlsx` file per semester via **Admin Panel → Upload Routine**.
The workbook **must contain exactly these 7 sheets** (sheet names are case-sensitive).

> Tip: Click **"Download Excel Template"** on the Homepage to get a pre-filled
> starter file with all sheets, headers, and one sample row.

### Sheet 1 — `Departments`
| Column | Required | Example |
|---|---|---|
| `dept_code` | ✅ | `CSE` |
| `dept_name` | ✅ | `Computer Science and Engineering` |

### Sheet 2 — `Teachers`
| Column | Required | Example |
|---|---|---|
| `teacher_code` | ✅ | `MF` |
| `teacher_name` | ✅ | `Md. Ferdous` |
| `dept_code` | ✅ | `CSE` |
| `designation` | ⭕ optional | `Lecturer`, `Assistant Professor`, `Associate Professor` |

### Sheet 3 — `Rooms`
| Column | Required | Example |
|---|---|---|
| `room_no` | ✅ | `407`, `411A` |
| `building` | ⭕ optional | `Main Building` |

### Sheet 4 — `Courses`
| Column | Required | Example |
|---|---|---|
| `course_code` | ✅ | `CSE404` |
| `course_name` | ✅ | `Computer Architecture` |
| `credit` | ✅ | `3.0` |
| `dept_code` | ✅ | `CSE` |

### Sheet 5 — `Sections`
| Column | Required | Allowed values | Example |
|---|---|---|---|
| `dept_code` | ✅ | any declared dept | `CSE` |
| `year` | ✅ | integer `1`–`4` | `4` |
| `semester` | ✅ | integer `1` or `2` (1 = odd term, 2 = even term) | `1` |

> A "section" is now identified by the triple `(dept_code, year, semester)` —
> `batch` and the free-text `section` column have been removed.
>
> Section label rendered on the timetable:
> - `dept=CSE, year=4, semester=1` → **`4-1`**
> - `dept=CSE, year=3, semester=2` → **`3-2`**
> - `dept=CSE, year=2, semester=2` → **`2-2`**

### Sheet 6 — `TimeSlots`
The system expects the standard **50-minute** university slots:

| start_time | end_time | Notes |
|---|---|---|
| `09:00` | `09:50` | |
| `09:50` | `10:40` | |
| `10:40` | `11:30` | |
| `11:30` | `12:20` | |
| `12:20` | `13:10` | Lab slot (12:20–2:00pm window) |
| — | — | **BREAK** (1:10–2:00pm, no entries) |
| `14:00` | `15:00` | |
| `15:00` | `16:00` | |

### Sheet 7 — `RoutineEntries`
| Column | Required | Example / Allowed values |
|---|---|---|
| `day` | ✅ | `SUN`, `MON`, `TUE`, `WED`, `THR` (also accepts `THU`/`THURSDAY`) |
| `dept_code` | ✅ | `CSE` (must match a row in the `Sections` sheet) |
| `year` | ✅ | `1`–`4` |
| `semester` | ✅ | `1` (odd term) or `2` (even term) |
| `course_code` | ✅ | `CSE404` |
| `teacher_code` | ✅ | `MF` |
| `room_no` | ✅ | `407` |
| `start_time` | ✅ | `10:40` |
| `end_time` | ✅ | `11:30` |

**Validation rules**
- All `code` fields must match an existing row in their master sheet.
- Day is normalized: `THU` / `THURSDAY` → `THR`.
- Rows in the break window (13:10–14:00) are rejected.
- The whole import runs in a single Prisma transaction — partial failures roll back.

## Running locally

```bash
# 1. Backend
cd server
npm install
npx prisma migrate dev
npm run dev          # http://localhost:5000

# 2. Frontend (in another terminal)
cd client
npm install
npm run dev          # http://localhost:5173
```

Or with Docker:
```bash
docker compose up --build
```

## Features
- 7-sheet Excel import with validation
- Multi-row timetable header (University → Department → Semester)
- **BREAK column** with vertical "B R E A K" label
- Auto-sorted sections and inline section labels (e.g. `4-1`, `3-2`, `2-2`)
- Class cells show **course code, teacher code, room number** stacked
- Per-course color highlighting (5-color palette, deterministic by hash)
- Teacher legend at the bottom of every routine
- PDF export (landscape) via html2canvas + jsPDF
- Semester / department / year / term filters
- Empty-state hero header with gradient and download-template CTA

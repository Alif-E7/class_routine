# Master Build Prompt — CSE Class Routine Generator

> Copy everything below (from "## PROJECT BRIEF" onward) and paste it as your first
> message into Claude Code, Cursor, or any AI coding agent. It is written to be
> self-contained — the agent should not need to ask clarifying questions to start.

---

## PROJECT BRIEF

Build a full-stack web application called **"CSE Routine Generator"** that takes a
structured Excel file describing teachers, courses, rooms, and scheduling rules, and
automatically generates a collision-free weekly class routine, exportable as a
formatted Word/PDF document (in the visual style of a university class routine grid:
days as rows, time slots as columns, with a break column, and a teacher legend below).

**Tech stack (required, do not substitute):**
- Frontend: React (Vite), Tailwind CSS
- Backend: Node.js + Express
- Database: MySQL
- File parsing: `xlsx` (SheetJS) npm package
- Document export: `docxtemplater` + `pizzip` for Word, then convert to PDF with
  `libreoffice --headless` or `docx-pdf`
- AI (optional assist layer only, never the core scheduler): Google Gemini API
  (`gemini-2.5-flash`) via `@google/generative-ai`, using an environment variable
  `GEMINI_API_KEY`. Keep the AI call behind an interface (`aiProvider.js`) so it can
  be swapped for OpenRouter or Claude later without touching business logic.

**Golden rule — read this before writing any scheduling code:**
The core scheduler MUST be a deterministic constraint-satisfaction (CSP) backtracking
algorithm written in plain JavaScript. It must guarantee zero double-booking of any
teacher, room, or year-semester by construction, not by asking an LLM to "avoid
conflicts." The AI provider is only used for: (a) natural-language explanations of the
generated schedule, (b) turning a free-text manual edit request into a structured
constraint change, and (c) suggesting fixes when the solver reports "infeasible." The
AI must never be the sole source of truth for the final schedule. If AI and solver
output conflict, the solver wins.

---

## 1. EXCEL INPUT FORMAT (must match exactly — do not rename sheets or columns)

The uploaded `.xlsx` file has exactly 7 data sheets. Column names below are the
literal header row text expected in row 1 (or row after any title/note rows — parser
should search for the header row by matching known column names, not assume a fixed
row number).

### Sheet: `Teachers`
| Column | Type | Notes |
|---|---|---|
| full_name | string | |
| abbreviation | string | UNIQUE, used as foreign key everywhere else |
| designation | string | |
| department | string | |

### Sheet: `Courses`
| Column | Type | Notes |
|---|---|---|
| course_code | string | UNIQUE within the sheet |
| course_name | string | |
| credit | decimal | must exist as a row in `Credit_Rules.credit` |
| dept | string | |
| year_sem | string | format "X-Y", e.g. "4-1", "3-2", "2-2", "2-1", "1-1" |
| teacher_abbr | string | must exist in `Teachers.abbreviation` |

Do NOT expect `type`, `preferred_room`, or `days_per_week` columns — these are
derived, never read directly from this sheet.

### Sheet: `Rooms`
| Column | Type | Notes |
|---|---|---|
| room_id | string | UNIQUE |
| room_name | string | |
| type | enum | exactly `classroom` or `lab` |

### Sheet: `Credit_Rules`
| Column | Type | Notes |
|---|---|---|
| credit | decimal | UNIQUE |
| type | enum | `Theory` or `Lab` |
| classes_per_week | integer | |
| duration_minutes | integer | |

Default seed data (use this exact table if the sheet is empty or as a validation
reference):

| credit | type | classes_per_week | duration_minutes |
|---|---|---|---|
| 3.0 | Theory | 3 | 50 |
| 2.0 | Theory | 2 | 50 |
| 0.5 | Lab | 1 | 60 |
| 1.0 | Lab | 1 | 120 |
| 1.5 | Lab | 1 | 240 |

Derivation rule as a safety fallback (only used if a credit value is missing from the
table and the row must be flagged, not silently guessed): `credit < 2.0` → Lab,
`credit >= 2.0` → Theory. Missing rows should always produce a hard validation error
listed to the user — never a silent default.

### Sheet: `Room_Preference`
| Column | Type | Notes |
|---|---|---|
| room_id | string | must exist in `Rooms.room_id` |
| year_group | enum | `1-2` or `3-4` |
| weight_percent | decimal | 0-100 |

`year_group` is derived from a course's `year_sem` first character: `1` or `2` → group
`1-2`; `3` or `4` → group `3-4`. This sheet defines the probability weight used when
the solver randomly selects among valid rooms of the correct type (classroom/lab) for
a course's year group. For each `(room type, year_group)` combination, weights across
matching rooms should sum close to 100 — validate and warn (not hard-fail) if they
don't.

### Sheet: `Teacher_Unavailability`
| Column | Type | Notes |
|---|---|---|
| teacher_abbr | string | must exist in `Teachers.abbreviation` |
| day | enum | `SUN, MON, TUE, WED, THU, FRI, SAT` |
| start_time | string | `HH:MM` 24-hour |
| end_time | string | `HH:MM` 24-hour |

No `reason` column. Sheet may contain only the header row if there are no
restrictions.

### Sheet: `Config`
Key-value pairs, columns `key` and `value`:
```
university      = Gopalganj Science and Technology University
department      = Computer Science and Engineering
semester         = 2026 June-December
working_days    = SUN,MON,TUE,WED,THU
class_start     = 09:00
class_end       = 15:50
break_start     = 13:00
break_end       = 14:00
```

---

## 2. DATABASE SCHEMA (MySQL — use this exact DDL, adjust only if you find a bug)

```sql
CREATE DATABASE IF NOT EXISTS routine_generator
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE routine_generator;

CREATE TABLE upload_batches (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  filename    VARCHAR(200) NOT NULL,
  semester    VARCHAR(100),
  status      ENUM('processing','completed','failed','needs_review') NOT NULL DEFAULT 'processing',
  error_log   TEXT,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE teachers (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  full_name       VARCHAR(100) NOT NULL,
  abbreviation    VARCHAR(10)  NOT NULL,
  designation     VARCHAR(60)  NOT NULL,
  department      VARCHAR(20)  NOT NULL,
  upload_batch_id INT NOT NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_teacher_abbr_batch (abbreviation, upload_batch_id),
  CONSTRAINT fk_teachers_batch FOREIGN KEY (upload_batch_id) REFERENCES upload_batches(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE courses (
  id                        INT AUTO_INCREMENT PRIMARY KEY,
  course_code               VARCHAR(20)  NOT NULL,
  course_name               VARCHAR(100) NOT NULL,
  credit                    DECIMAL(3,1) NOT NULL,
  dept                      VARCHAR(20)  NOT NULL,
  year_sem                  VARCHAR(10)  NOT NULL,
  teacher_abbr              VARCHAR(10)  NOT NULL,
  derived_type              ENUM('theory','lab') NOT NULL,
  derived_duration_min      INT NOT NULL,
  derived_classes_per_week  INT NOT NULL,
  upload_batch_id           INT NOT NULL,
  created_at                TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_course_batch (course_code, upload_batch_id),
  KEY idx_course_teacher (teacher_abbr),
  CONSTRAINT fk_courses_batch FOREIGN KEY (upload_batch_id) REFERENCES upload_batches(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE rooms (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  room_id         VARCHAR(20) NOT NULL,
  room_name       VARCHAR(50) NOT NULL,
  type            ENUM('classroom','lab') NOT NULL,
  upload_batch_id INT NOT NULL,
  UNIQUE KEY uniq_room_batch (room_id, upload_batch_id),
  CONSTRAINT fk_rooms_batch FOREIGN KEY (upload_batch_id) REFERENCES upload_batches(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE credit_rules (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  credit            DECIMAL(3,1) NOT NULL,
  type              ENUM('theory','lab') NOT NULL,
  classes_per_week  INT NOT NULL,
  duration_minutes  INT NOT NULL,
  upload_batch_id   INT NOT NULL,
  UNIQUE KEY uniq_credit_batch (credit, upload_batch_id),
  CONSTRAINT fk_credit_rules_batch FOREIGN KEY (upload_batch_id) REFERENCES upload_batches(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE room_preference (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  room_id         VARCHAR(20) NOT NULL,
  year_group      ENUM('1-2','3-4') NOT NULL,
  weight_percent  DECIMAL(5,2) NOT NULL,
  upload_batch_id INT NOT NULL,
  UNIQUE KEY uniq_room_yeargroup_batch (room_id, year_group, upload_batch_id),
  CONSTRAINT fk_room_preference_batch FOREIGN KEY (upload_batch_id) REFERENCES upload_batches(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE teacher_unavailability (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  teacher_abbr    VARCHAR(10) NOT NULL,
  day             ENUM('SUN','MON','TUE','WED','THU','FRI','SAT') NOT NULL,
  start_time      TIME NOT NULL,
  end_time        TIME NOT NULL,
  upload_batch_id INT NOT NULL,
  KEY idx_unavail_teacher (teacher_abbr, day),
  CONSTRAINT fk_teacher_unavail_batch FOREIGN KEY (upload_batch_id) REFERENCES upload_batches(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE config (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  `key`           VARCHAR(50)  NOT NULL,
  `value`         VARCHAR(200) NOT NULL,
  upload_batch_id INT NOT NULL,
  UNIQUE KEY uniq_config_key_batch (`key`, upload_batch_id),
  CONSTRAINT fk_config_batch FOREIGN KEY (upload_batch_id) REFERENCES upload_batches(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE schedules (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  batch_id       INT NOT NULL,
  course_code    VARCHAR(20) NOT NULL,
  teacher_abbr   VARCHAR(10) NOT NULL,
  room_id        VARCHAR(20) NOT NULL,
  day            ENUM('SUN','MON','TUE','WED','THU') NOT NULL,
  slot_start     TIME NOT NULL,
  slot_end       TIME NOT NULL,
  year_sem       VARCHAR(10) NOT NULL,
  session_index  INT NOT NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_teacher_slot  (batch_id, teacher_abbr, day, slot_start),
  UNIQUE KEY uniq_room_slot     (batch_id, room_id, day, slot_start),
  UNIQUE KEY uniq_semester_slot (batch_id, year_sem, day, slot_start),
  CONSTRAINT fk_schedules_batch FOREIGN KEY (batch_id) REFERENCES upload_batches(id) ON DELETE CASCADE
) ENGINE=InnoDB;
```

---

## 3. BACKEND REQUIREMENTS

### 3.1 Folder structure
```
backend/
  src/
    routes/
      upload.js         POST /api/upload           (multer + parse + validate + persist)
      schedule.js        POST /api/batches/:id/generate   (run solver)
                          POST /api/batches/:id/edit       (AI-assisted manual edit)
      export.js           GET  /api/batches/:id/export.docx
                          GET  /api/batches/:id/export.pdf
      batches.js          GET  /api/batches, GET /api/batches/:id
    services/
      excelParser.js      xlsx -> validated structured JSON
      validators.js        all hard-validation rules (see section 4)
      deriveRules.js       credit -> type/duration/classes_per_week
      scheduler.js          CSP backtracking core (see section 5)
      roomSelector.js       weighted random room selection
      docxGenerator.js      build the routine grid docx from schedule rows
      aiProvider.js          thin wrapper around Gemini (or swappable provider)
    db/
      pool.js                mysql2 connection pool
      migrations/            SQL migration files (use the schema in section 2)
    app.js
    server.js
  templates/
    routine_template.docx    pre-built Word template matching the reference photo layout
  .env.example
  package.json
```

### 3.2 Environment variables (`.env.example`)
```
DB_HOST=localhost
DB_PORT=3306
DB_USER=cse_admin
DB_PASSWORD=changeme
DB_NAME=routine_generator
GEMINI_API_KEY=
PORT=4000
```

### 3.3 Upload endpoint behavior
1. Accept `.xlsx` via multipart form (`multer`, memory storage, 10MB limit).
2. Parse all 7 sheets with `xlsx`. Find header row by matching expected column
   names (do not assume row 1 — allow for title rows above it, matching how the
   provided template file is structured with a title row before headers on some
   sheets).
3. Run every validation rule from section 4. If any hard-fail rule triggers, do NOT
   write to the database. Create an `upload_batches` row with
   `status='needs_review'` and a JSON `error_log` listing every problem found (not
   just the first one — collect all, then report all).
4. If validation passes, insert into `upload_batches` (`status='processing'`), then
   insert rows into `teachers`, `rooms`, `credit_rules`, `room_preference`,
   `teacher_unavailability`, `config` exactly as parsed, and into `courses` with
   `derived_type` / `derived_duration_min` / `derived_classes_per_week` filled in via
   `deriveRules.js`. Wrap all inserts in a single DB transaction. Set
   `status='completed'` only after all inserts succeed; roll back and set
   `status='failed'` with `error_log` on any DB error.
5. Return the batch id and a summary (counts of teachers/courses/rooms parsed) to the
   frontend.

### 3.4 Generate endpoint behavior
1. Load all data for the given `batch_id` from the DB.
2. Run `scheduler.js` (section 5).
3. On success: bulk-insert into `schedules` inside a transaction (the three UNIQUE
   KEYs on `schedules` are a second line of defense — if a race condition or bug ever
   produces a collision, the insert fails loudly instead of silently corrupting data).
4. On failure (`infeasible`): do not insert anything. Return a structured error
   describing which course(s) could not be placed and why (e.g. "CSE406L: no free lab
   room + teacher DMKB slot found in the allowed hours"). Optionally call
   `aiProvider.js` to turn that structured reason into a friendly suggestion for the
   admin (e.g. "consider adding a second lab room or reducing DMKB's unavailability
   window"). This AI call is advisory text only — it must never alter the database.

### 3.5 Export endpoint behavior
- Build a grid: rows = `Config.working_days`, columns = time slots derived from
  `class_start`/`class_end`/`break_start`/`break_end` at the union of all distinct
  `slot_start` times actually used in `schedules` for that batch (mirrors the visual
  style of the reference photo: day rows, year-sem sub-rows, a merged "BREAK" column).
- Use `docxtemplater` with a template that has the university header block, the grid
  table, and a teacher legend table (name / designation / department) below,
  auto-populated from `teachers`.
- For PDF, convert the generated `.docx` with `libreoffice --headless --convert-to pdf`
  run as a child process (document this system dependency in the README).

---

## 4. VALIDATION RULES (run all of these; collect every failure, don't stop at first)

- Every `teacher_abbr` referenced in `Courses` and `Teacher_Unavailability` exists in
  `Teachers.abbreviation`.
- Every `credit` in `Courses` exists in `Credit_Rules.credit`.
- Every `room_id` in `Room_Preference` exists in `Rooms.room_id`.
- `Rooms.type` is exactly `classroom` or `lab` (case-sensitive check, then normalize).
- `course_code` values are unique within `Courses`.
- `abbreviation` values are unique within `Teachers`.
- `Room_Preference` weights for each `(room type, year_group)` group sum to
  approximately 100 (±1) — warn, don't hard-fail, if off.
- `Config.break_start < Config.break_end`, `Config.class_start < Config.break_start`,
  `Config.break_end < Config.class_end`.
- `Teacher_Unavailability.start_time < end_time`.
- For every course, verify a feasibility pre-check before solving: does at least one
  room of the correct type exist, and does the teacher have at least
  `classes_per_week` free day-slots outside their unavailability window? If not,
  report it as a validation warning before even attempting the solver (fail fast,
  clear message, rather than a slow doomed backtracking run).

---

## 5. CORE SCHEDULING ALGORITHM (deterministic CSP backtracking)

Implement in `scheduler.js`. Pseudocode contract the agent must follow:

```javascript
// Inputs: courses (with derived_type/duration/classes_per_week), rooms,
// room_preference, teacher_unavailability, config (days, start/end, break)
//
// Output: array of { course_code, teacher_abbr, room_id, day, slot_start, slot_end,
// year_sem, session_index } OR throws SchedulingError listing unplaceable courses.

function solve(input) {
  const daySlots = buildAvailableWindows(input.config); // per day, minus break
  const ordered = sortByConstraintTightness(input.courses); // most-constrained-first:
    // fewer valid rooms, more classes_per_week, teacher with more unavailability -> first

  const teacherBusy = new IntervalMap();
  const roomBusy = new IntervalMap();
  const semBusy = new IntervalMap();
  const assignments = [];

  function backtrack(i) {
    if (i === ordered.length) return true;
    const course = ordered[i];
    const usedDays = new Set();

    for (let session = 0; session < course.derived_classes_per_week; session++) {
      const candidateDays = shuffledUnusedDays(input.config.working_days, usedDays);
      let placed = tryPlaceOnAnyDay(course, session, candidateDays,
        daySlots, teacherBusy, roomBusy, semBusy, input, assignments, usedDays);
      if (!placed) {
        undoAssignmentsForCourse(assignments, course.course_code,
          teacherBusy, roomBusy, semBusy);
        return false;
      }
    }

    if (backtrack(i + 1)) return true;
    undoAssignmentsForCourse(assignments, course.course_code,
      teacherBusy, roomBusy, semBusy);
    return false;
  }

  if (!backtrack(0)) {
    throw new SchedulingError(collectUnplaceableReasons(...));
  }
  return assignments;
}
```

Hard requirements:
- A teacher, a room, and a year-semester group each get an `IntervalMap` (day ->
  sorted list of busy [start,end) ranges); every placement check does an O(log n)
  overlap check before committing.
- Room selection within a valid time window uses `roomSelector.js`'s weighted-random
  pick from `Room_Preference` (rooms of the correct `type`, matching the course's
  `year_group`), falling back to uniform random among same-type rooms if no
  preference row exists for that room, and skipping rooms that are already busy in
  that window (not just picking the top-weighted one and giving up).
- A course's multiple weekly sessions must land on distinct days.
- Respect `Teacher_Unavailability`: no assignment may overlap a listed window for
  that teacher.
- On backtrack, correctly undo every busy-map entry and assignment made for the
  course being retried before trying the next branch — write a unit test that
  specifically exercises the undo path (e.g. force a dead end 3 courses deep and
  assert the busy maps return to their prior state).
- Provide a maximum backtrack/iteration budget (e.g. 200,000 node expansions) after
  which it throws `SchedulingError('exceeded search budget')` rather than hanging —
  never let this run unbounded in a request handler.

Write Jest unit tests for: (a) a trivially solvable small instance, (b) a
deliberately infeasible instance (two 3-credit theory courses, same teacher, same
year-sem, only one room, more classes_per_week than available days) and assert it
throws with a clear reason, (c) the undo/backtrack correctness test above, (d) a test
that asserts zero output collisions across 20 randomized instance generations.

---

## 6. FRONTEND REQUIREMENTS

Pages (React Router):
1. **Upload** — drag-and-drop `.xlsx`, calls `POST /api/upload`, shows parsed counts
   or a categorized list of validation errors (grouped by sheet).
2. **Preview** — read-only tables of what was parsed per sheet, with a "Generate
   Routine" button that calls `POST /api/batches/:id/generate`.
3. **Routine** — renders the generated grid (days as rows, time as columns, break
   column merged, year-sem sub-rows within each day, matching the visual reference
   layout) using data from `GET /api/batches/:id`. Includes a "Download Word" /
   "Download PDF" button hitting the export endpoints, and an "Ask AI to explain /
   edit" text box that posts free text to `POST /api/batches/:id/edit`.
4. **History** — list of past `upload_batches` with status badges.

Use Tailwind for styling; keep the routine grid table visually close to the
reference photo (bordered cells, bold day labels in a left header column, merged
"BREAK" column, teacher legend table below).

---

## 7. BUILD ORDER (do these phases in sequence, don't skip ahead)

1. Scaffold repo (`frontend/`, `backend/`), install dependencies, set up MySQL schema
   from section 2, confirm the app boots end-to-end with a health-check route.
2. Implement `excelParser.js` + `validators.js` + upload endpoint. Test against the
   provided template file with intentionally broken sample data (missing
   teacher_abbr, unknown credit, bad weight sums) to confirm every validation rule
   fires correctly.
3. Implement `deriveRules.js` and confirm derived_type/duration/classes_per_week are
   correctly cached on `courses` at insert time.
4. Implement `scheduler.js` and its unit tests (section 5) BEFORE wiring it to any
   HTTP route. Do not proceed until all four described tests pass.
5. Wire the generate endpoint, `roomSelector.js`, and DB persistence with the
   transaction + UNIQUE KEY safety net.
6. Build the React upload -> preview -> generate -> routine view flow against the
   real API (no mock data once step 5 is done).
7. Implement `docxGenerator.js` against `templates/routine_template.docx` and the
   PDF export path; visually compare output to the reference photo layout.
8. Wire `aiProvider.js` (Gemini) for the explain/edit assist feature only — confirm
   it never bypasses the solver.
9. reWrite a top-level `README.md` covering: local setup, environment variables,
   running migrations, running tests, and the LibreOffice system dependency for PDF
   export.

---

## 8. NON-FUNCTIONAL REQUIREMENTS

- All DB writes for a single upload or generate operation happen in one transaction.
- Never trust the Excel file's data types blindly — coerce and validate before
  insert (e.g. `credit` must parse as a number, `day` must be one of the enum
  values).
- Log every validation failure and scheduling failure with enough detail to debug
  without re-running (batch id, course code, reason).
- Rate-limit the AI-assist endpoint (it's optional and should never block core
  scheduling functionality if the AI provider is down or the free quota is
  exhausted — catch and degrade gracefully to "AI explanation unavailable, here is
  the raw solver output" rather than failing the request).

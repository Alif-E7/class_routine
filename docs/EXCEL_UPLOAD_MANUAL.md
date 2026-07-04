# Excel Upload Manual

> The authoritative reference for `.xlsx` files uploaded to the Class Routine system.
> If you follow this exactly, the upload will **never** fail with a validation error.

This manual is derived directly from the source of truth:

- `server/prisma/schema.prisma` — global-masters schema
- `server/src/services/excel.service.js` — header normalisation, sheet parsing
- `server/src/services/import.service.js` — preprocessing, DB merge, persist
- `server/src/services/validation.service.js` — FK + conflict checks
- `server/src/services/lint.service.js` — pre-flight linter (R1–R10)
- `server/src/controllers/template.controller.js` — template generator
- `client/src/components/FileUpload.jsx` — upload form contract

---

## 1. Why your past uploads sometimes failed

The codebase is correct. **Every past error came from the Excel file**, not from the server.

| Past error you saw | What it actually meant in your file |
|---|---|
| `Sheet 'RoutineEntries' is missing required columns: …` | Header text didn't match a known alias (e.g. `Class Start` instead of `start_time`). Use the exact canonical headers below. |
| `RoutineEntry row N: Invalid course_code 'MATH101'` | `MATH101` was referenced in `RoutineEntries` but didn't exist anywhere — not in the `Courses` sheet, not in the DB yet. Fix: include it in the `Courses` sheet (or upload it once, then re-upload). |
| `Conflict at row N: Teacher 'MF' is double booked …` | Two routine rows assigned the same teacher to two rooms/sections at the same slot. Edit the spreadsheet to remove the duplicate. |
| `Mapping failed for RoutineEntry. Missing database records for [course: "X", …]` | A row references codes that exist **nowhere** — not in any sheet, not in the DB. Fix: add the missing master row or correct the typo. |
| `Foreign Key Validation Failed` | A `Teacher.dept_code` or `Course.dept_code` doesn't match any row in the `Departments` sheet. Add the department row. |
| `Sheet 'X' is missing required columns: dept_code` | You left `dept_code` blank on a master sheet but didn't write `(Auto-filled)`. Fix: write `(Auto-filled)` literally, **or delete the master sheet entirely** (the form's `departmentCode` field handles it). |
| File uploads but routine is empty / partial | Rows with an explicit `dept_code` that differs from the upload form are **silently dropped** by the preprocessor. Always use `(Auto-filled)` or blank. |

**The single most important rule:** the upload form's `Department Code` field is the **source of truth** for `dept_code` — not the spreadsheet. The pipeline will overwrite any blank or `(Auto-filled)` cell with what you typed in the form.

---

## 2. The upload form (what you type in the UI)

`FileUpload.jsx` sends exactly three things:

| Field | Required | Example | What it does |
|---|---|---|---|
| `semesterName` | yes | `January-July 2025` | Creates/looks up the `Semester` row (unique on `name`). Re-using the same name **merges** into that semester — no duplicates. |
| `departmentCode` | yes | `CSE` (auto-uppercased in the UI) | Becomes the `dept_code` for every row. Stored in `RoutineEntry.section.deptCode`. |
| `file` | yes | `.xlsx` | Parsed as the workbook described below. |

The form calls **two** endpoints in sequence:

1. `POST /api/upload-routine/lint` — pre-flight check (dry-run, no DB writes). Surfaces every R1–R10 violation as a toast. **If it returns errors, the upload is aborted.**
2. `POST /api/upload-routine` — the real import (parse → preprocess → validate → persist).

---

## 3. The canonical Excel file (the only format that will never fail)

The file may contain **1 to 7 sheets**. Only `RoutineEntries` is mandatory. The other six are optional and only needed when introducing brand-new masters.

> **Tip:** If you are only re-uploading a routine for an existing department, **delete every sheet except `RoutineEntries`**. The pipeline auto-pulls teachers, courses, rooms, sections, and time slots from the DB when they are referenced.

---

### 3.1 `RoutineEntries` — **REQUIRED**

These **9 columns**, exact spelling (column order doesn't matter):

| Column | Type | Required | Example | Validation |
|---|---|---|---|---|
| `day` | text | yes | `SUN` | One of `SUN MON TUE WED THR FRI SAT`. `THU`/`THURSDAY` auto-normalised to `THR`. |
| `dept_code` | text | optional | `(Auto-filled)` or blank | Overwritten by the form's `departmentCode`. Use `(Auto-filled)` literally. |
| `year` | int | yes | `4` | `1`, `2`, `3`, or `4` (year of study). |
| `semester` | int | yes | `1` | `1` (odd) or `2` (even). Combined with `year` → `Section` key. |
| `course_code` | text | yes | `CSE404` | Must exist in `Courses` sheet or already in DB. |
| `teacher_code` | text | yes | `MF` | Must exist in `Teachers` sheet or already in DB. |
| `room_no` | text | yes | `407` | Must exist in `Rooms` sheet or already in DB. |
| `start_time` | text | yes | `10:40` | `HH:MM` 24-hour, regex `^([01]\d\|2[0-3]):([0-5]\d)$`. |
| `end_time` | text | yes | `11:30` | Same format. Must be **strictly after** `start_time`. |

**Minimal example for CSE (the entire file — 1 sheet only):**

| day | dept_code | year | semester | course_code | teacher_code | room_no | start_time | end_time |
|-----|-----------|------|----------|-------------|--------------|---------|------------|----------|
| SUN | (Auto-filled) | 4 | 1 | CSE404 | MF | 407 | 10:40 | 11:30 |
| MON | (Auto-filled) | 4 | 1 | MATH101 | SY | 411A | 09:00 | 09:50 |
| TUE | (Auto-filled) | 3 | 2 | CSE302L | SM | Lab1 | 15:40 | 17:10 |

Upload form: `semesterName = "January-July 2025"`, `departmentCode = "CSE"`. **Done.**

---

### 3.2 Optional reference sheets (only when adding brand-new masters)

#### `Departments`

| Column | Type | Required | Example |
|---|---|---|---|
| `dept_code` | text | yes | `CSE` (or `(Auto-filled)`) |
| `dept_name` | text | yes | `Computer Science and Engineering` |
| `faculty` | text | yes | `Engineering` (or `Science`, `Life Science`, `Humanities`, `Business`, `Other`) |

#### `Teachers`

| Column | Type | Required | Example |
|---|---|---|---|
| `teacher_code` | text | yes | `MF` |
| `teacher_name` | text | yes | `Md. Ferdous` |
| `dept_code` | text | optional | `(Auto-filled)` (set by form) |
| `designation` | text | optional | `Lecturer` |

#### `Rooms`

| Column | Type | Required | Example |
|---|---|---|---|
| `room_no` | text | yes | `407` |
| `building` | text | optional | `Main Building` |

#### `Courses`

| Column | Type | Required | Example |
|---|---|---|---|
| `course_code` | text | yes | `CSE404` |
| `course_name` | text | yes | `Computer Architecture` |
| `credit` | number | yes | `3` or `1.5` |
| `dept_code` | text | optional | `(Auto-filled)` (set by form) |

If you reference a **service course** from another dept (e.g. `MATH101` taught by `SY` to a CSE section), set `dept_code = MATH` for that course row — it must match the `Departments` sheet.

#### `Sections`

| Column | Type | Required | Example |
|---|---|---|---|
| `dept_code` | text | optional | `(Auto-filled)` (set by form) |
| `year` | int | yes | `4` |
| `semester` | int | yes | `1` |

Every `(dept_code, year, semester)` combo referenced by a `RoutineEntries` row is **auto-created**. You only need this sheet if you want to pre-declare sections without a routine yet.

#### `TimeSlots`

| Column | Type | Required | Example |
|---|---|---|---|
| `start_time` | text | yes | `09:00` |
| `end_time` | text | yes | `09:50` |

Slots referenced by `RoutineEntries` are auto-added. Include this sheet only if you want them pre-declared (e.g. a 2-period lab at `15:40–17:10` that doesn't appear elsewhere).

---

## 4. Header alias tolerance

`excel.service.js` normalises each header by **lowercasing + replacing spaces with underscores**, then looks it up in the alias map. Common synonyms:

| Canonical | Accepted aliases |
|---|---|
| `dept_code` | `dept`, `department`, `department_code`, `deptcode` |
| `course_code` | `course`, `coursecode`, `course_id`, `subject`, `subject_code`, `code` |
| `room_no` | `room`, `roomno`, `room_number`, `room_num`, `classroom`, `hall`, `lab` |
| `start_time` | `start`, `starttime`, `from`, `time_from`, `begin`, `class_start` |
| `end_time` | `end`, `endtime`, `to`, `time_to`, `finish`, `class_end` |
| `year` | `yr`, `level` |
| `semester` | `sem`, `term` |
| `day` | `weekday`, `day_of_week` |

> **Tip:** just use the canonical names. The aliases exist for legacy files, not for new ones.

---

## 5. The 10 rules (every upload must satisfy)

The pre-flight linter (`server/src/services/lint.service.js`) and the in-pipeline validator (`server/src/services/validation.service.js`) together enforce these 10 rules.

| # | Rule | Stage |
|---|---|---|
| **R1** | `RoutineEntries` sheet must exist and have ≥ 1 data row, with all required fields filled. | parse + lint |
| **R2** | Each present sheet must have its canonical columns. | validate + lint |
| **R3** | The form must supply `departmentCode`. Sheet rows may leave `dept_code` blank or `(Auto-filled)`; **explicit mismatches are silently dropped**. | preprocess + lint (warning) |
| **R4** | `day ∈ {SUN, MON, TUE, WED, THR, FRI, SAT}` (case-insensitive; `THU`/`THURSDAY` → `THR`). | validate + lint |
| **R5** | `year ∈ {1, 2, 3, 4}`. | validate + lint |
| **R6** | `semester ∈ {1, 2}`. | validate + lint |
| **R7** | Times are `HH:MM` 24-hour; `end_time > start_time`. | validate + lint |
| **R8** | Every referenced `course_code` / `teacher_code` / `room_no` / `dept_code` must exist in the sheet **or** in the DB (warning only — DB merge handles it). | merge + lint |
| **R9** | No teacher or room double-booking (flat across the sheet) **and** no section double-booking (parallel lab groups are OK if teacher AND room differ). | conflict check + lint |
| **R10** | `faculty ∈ {Engineering, Science, Life Science, Humanities, Business, Other}`. | lint |

The CLI wrapper is `npm run lint:excel -- file.xlsx --dept CSE` (see §9).

---

## 6. Assignment of data — who supplies what

| Piece of data | Where it comes from |
|---|---|
| `Semester.name` | Upload form's `semesterName` field |
| `Semester.year` | Server-side: `new Date().getFullYear()` at upload time |
| `RoutineEntry.deptCode` | Upload form's `departmentCode` field (overrides sheet) |
| `Section` identity | Derived from `(deptCode, year, semester)` in your `RoutineEntries` rows — auto-created |
| `Department` rows | Upload form + any cross-dept rows in your `Departments` sheet (e.g. `MATH` for service courses) |
| `Teacher`, `Course`, `Room`, `TimeSlot` rows | Your sheet **or** auto-pulled from DB if previously uploaded |
| `RoutineEntry.day` normalisation | `THU`/`THURSDAY` → `THR` automatically |
| Teacher/room double-booking check | Across the entire `RoutineEntries` sheet — **including cross-dept rows** |

---

## 7. CSE case-study (your specific file)

Given your CSE file's structure, here's the exact recipe that will **never fail**:

1. Click **Download Template** in the Dashboard → that gives you a known-good `Routine_Template.xlsx`. Use it as the starting point.
2. **Delete every sheet except `RoutineEntries`.** CSE dept, teachers, courses, rooms, sections, and time slots already exist in the DB from your earlier successful upload.
3. Replace the `RoutineEntries` rows with your CSE class schedule, keeping headers exactly:
   `day, dept_code, year, semester, course_code, teacher_code, room_no, start_time, end_time`
4. Set `dept_code` to `(Auto-filled)` (or blank) on **every row**.
5. In the upload form:
   - `semesterName` = whatever you used last time (e.g. `July-December 2026`), so it merges into the existing semester
   - `departmentCode` = `CSE`
6. Click **Import Routine**. You'll see `Checking file…` → `Importing…` → success toast.

The pipeline will:

1. Auto-fill `dept_code = CSE` on every row.
2. Pull CSE and any referenced MATH dept/teacher/course records from the DB (no need to re-declare them).
3. Validate FKs (Teacher/Course `dept_code`s vs Departments sheet + DB).
4. Reject any row that double-books a teacher or room.
5. **Delete** the existing CSE routine rows for that semester and **insert** the new ones.

If anything fails, the error toast will say exactly which row and why (e.g. `[R4] RoutineEntries · row 17 · day — Invalid day 'FUN'. Must be one of SUN, MON, TUE, WED, THR, FRI, SAT (case-insensitive).`). Fix that row and re-upload — the upload is **idempotent** on `(semester, dept)`.

---

## 8. Ironclad rules summary

1. **One sheet is enough** — `RoutineEntries`. Delete the other six if you don't need them.
2. **Headers must match exactly** — copy them from `Routine_Template.xlsx`.
3. **`dept_code` on every row = `(Auto-filled)` or blank** — the form fills it.
4. **`day ∈ {SUN MON TUE WED THR FRI SAT}`**. Anything else fails.
5. **`year ∈ {1, 2, 3, 4}`**, **`semester ∈ {1, 2}`**.
6. **Times are `HH:MM` 24-hour**; `end_time` strictly after `start_time`.
7. **Every `course_code` / `teacher_code` / `room_no` / section must exist** (in your sheet or in the DB).
8. **No teacher/room double-booking** within the sheet.
9. **Upload form's `departmentCode` is the source of truth** for `dept_code`.
10. **Re-uploading the same `(semester, dept)` is safe** — it replaces that dept's routines, leaves everything else alone.

---

## 9. How to verify a file before uploading

```bash
cd server
npm run lint:excel -- path/to/CSE_Routine.xlsx --dept CSE
```

Exit code `0` = safe to upload. Exit code `1` = fix the listed errors. The output shows `R1`–`R10` rule violations with row, column, and message. JSON mode (`--json`) is available for CI/programmatic use.

You can also use the in-app pre-flight: the upload form calls `POST /api/upload-routine/lint` before `POST /api/upload-routine` and surfaces every violation as a toast.

---

## 10. Quick reference — the one-sheet file

If you only ever do the bare minimum, this is the entire file:

```
Sheet name: RoutineEntries
Headers:    day, dept_code, year, semester, course_code, teacher_code, room_no, start_time, end_time
```

One row:

| day | dept_code | year | semester | course_code | teacher_code | room_no | start_time | end_time |
|-----|-----------|------|----------|-------------|--------------|---------|------------|----------|
| SUN | (Auto-filled) | 1 | 1 | COURSE_CODE | TEACHER_CODE | ROOM_NO | 09:00 | 09:50 |

Upload form: `semesterName = "<anything unique>"`, `departmentCode = CSE`. Import. Done.
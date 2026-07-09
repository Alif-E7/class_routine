-- Migration 003: Add Year_Sem and Day_Preference tables
-- (tables are also documented in 001_initial.sql as the canonical schema reference)

-- ─────────────────────────────────────────────────────────────────────────────
-- year_sem: master lookup — every possible year-semester (1-1 … 4-2).
-- group_code links to Room_Preference.year_group (junior='1-2', senior='3-4').
-- is_active = 1 means this year_sem is currently running; only active ones
-- are scheduled. Working days: SUN, MON, TUE, WED, THU.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS year_sem (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  year_sem        VARCHAR(10)  NOT NULL,
  year            TINYINT UNSIGNED NOT NULL,
  semester        TINYINT UNSIGNED NOT NULL,
  group_code      ENUM('1-2','3-4') NOT NULL,
  is_active       TINYINT(1)   NOT NULL DEFAULT 0,
  upload_batch_id INT NOT NULL,
  UNIQUE KEY uniq_ys_batch (year_sem, upload_batch_id),
  CONSTRAINT fk_year_sem_batch FOREIGN KEY (upload_batch_id)
    REFERENCES upload_batches(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ─────────────────────────────────────────────────────────────────────────────
-- day_preference: soft scheduling bias — Lab vs Theory weight per weekday.
-- Theory weight is the auto-complement (100 - Lab%). Both rows are stored
-- for query simplicity even though only Lab is the input signal.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS day_preference (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  day             ENUM('SUN','MON','TUE','WED','THU','FRI','SAT') NOT NULL,
  class_type      ENUM('Lab','Theory') NOT NULL,
  weight_percent  DECIMAL(5,2) NOT NULL,
  note            VARCHAR(200) NULL,
  upload_batch_id INT NOT NULL,
  UNIQUE KEY uniq_dp_batch (day, class_type, upload_batch_id),
  CONSTRAINT fk_day_pref_batch FOREIGN KEY (upload_batch_id)
    REFERENCES upload_batches(id) ON DELETE CASCADE
) ENGINE=InnoDB;

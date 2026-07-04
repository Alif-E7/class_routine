-- Initial schema for the CSE Routine Generator
-- (verbatim from PROJECT_BUILD_PROMPT.md section 2)

CREATE TABLE IF NOT EXISTS upload_batches (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  filename    VARCHAR(200) NOT NULL,
  semester    VARCHAR(100),
  status      ENUM('processing','completed','failed','needs_review') NOT NULL DEFAULT 'processing',
  error_log   TEXT,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS teachers (
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

CREATE TABLE IF NOT EXISTS courses (
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

CREATE TABLE IF NOT EXISTS rooms (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  room_id         VARCHAR(20) NOT NULL,
  room_name       VARCHAR(50) NOT NULL,
  type            ENUM('classroom','lab') NOT NULL,
  upload_batch_id INT NOT NULL,
  UNIQUE KEY uniq_room_batch (room_id, upload_batch_id),
  CONSTRAINT fk_rooms_batch FOREIGN KEY (upload_batch_id) REFERENCES upload_batches(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS credit_rules (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  credit            DECIMAL(3,1) NOT NULL,
  type              ENUM('theory','lab') NOT NULL,
  classes_per_week  INT NOT NULL,
  duration_minutes  INT NOT NULL,
  upload_batch_id   INT NOT NULL,
  UNIQUE KEY uniq_credit_batch (credit, upload_batch_id),
  CONSTRAINT fk_credit_rules_batch FOREIGN KEY (upload_batch_id) REFERENCES upload_batches(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS room_preference (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  room_id         VARCHAR(20) NOT NULL,
  year_group      ENUM('1-2','3-4') NOT NULL,
  weight_percent  DECIMAL(5,2) NOT NULL,
  upload_batch_id INT NOT NULL,
  UNIQUE KEY uniq_room_yeargroup_batch (room_id, year_group, upload_batch_id),
  CONSTRAINT fk_room_preference_batch FOREIGN KEY (upload_batch_id) REFERENCES upload_batches(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS teacher_unavailability (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  teacher_abbr    VARCHAR(10) NOT NULL,
  day             ENUM('SUN','MON','TUE','WED','THU','FRI','SAT') NOT NULL,
  start_time      TIME NOT NULL,
  end_time        TIME NOT NULL,
  upload_batch_id INT NOT NULL,
  KEY idx_unavail_teacher (teacher_abbr, day),
  CONSTRAINT fk_teacher_unavail_batch FOREIGN KEY (upload_batch_id) REFERENCES upload_batches(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS config (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  `key`           VARCHAR(50)  NOT NULL,
  `value`         VARCHAR(200) NOT NULL,
  upload_batch_id INT NOT NULL,
  UNIQUE KEY uniq_config_key_batch (`key`, upload_batch_id),
  CONSTRAINT fk_config_batch FOREIGN KEY (upload_batch_id) REFERENCES upload_batches(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS schedules (
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

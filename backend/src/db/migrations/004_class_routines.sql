-- Migration 004: Add class_routines table for publishing routines by Faculty, Department, Year, and Term
CREATE TABLE IF NOT EXISTS class_routines (
  id INT AUTO_INCREMENT PRIMARY KEY,
  batch_id INT NOT NULL,
  department VARCHAR(100) NOT NULL,
  faculty VARCHAR(100) NOT NULL,
  year VARCHAR(50) NOT NULL,
  term ENUM('Fall', 'Spring') NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_class_routines_batch FOREIGN KEY (batch_id) REFERENCES upload_batches(id) ON DELETE CASCADE
) ENGINE=InnoDB;

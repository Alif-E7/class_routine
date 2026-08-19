-- Migration 005: Routine Template v2 Schema and Data Updates

-- 1. Expand department column lengths in teachers and courses
ALTER TABLE teachers MODIFY COLUMN department VARCHAR(150) NOT NULL;
ALTER TABLE courses MODIFY COLUMN dept VARCHAR(150) NOT NULL;

-- 2. Add faculty and year columns to upload_batches if they don't already exist
SET @dbname = DATABASE();
SET @tablename = 'upload_batches';
SET @columnname = 'faculty';
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname
      AND TABLE_NAME = @tablename
      AND COLUMN_NAME = @columnname
  ) > 0,
  'SELECT 1',
  'ALTER TABLE upload_batches ADD COLUMN faculty VARCHAR(100) NULL AFTER filename'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @columnname = 'year';
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname
      AND TABLE_NAME = @tablename
      AND COLUMN_NAME = @columnname
  ) > 0,
  'SELECT 1',
  'ALTER TABLE upload_batches ADD COLUMN year INT NULL AFTER faculty'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 3. Data Migration: Update short department codes and names in teachers, courses, config, class_routines
UPDATE teachers
SET department = CASE
  WHEN department IN ('CSE', 'Computer Science and Engineering') THEN 'Computer Science and Engineering (CSE)'
  WHEN department IN ('EEE', 'Electrical and Electronic Engineering') THEN 'Electrical and Electronic Engineering (EEE)'
  WHEN department IN ('ETE', 'Electronics and Telecommunication Engineering') THEN 'Electronics and Telecommunication Engineering (ETE)'
  WHEN department IN ('ACCE', 'Applied Chemistry and Chemical Engineering') THEN 'Applied Chemistry and Chemical Engineering (ACCE)'
  WHEN department IN ('CE', 'Civil Engineering') THEN 'Civil Engineering (CE)'
  WHEN department IN ('FE', 'FAPE', 'Food Engineering', 'Food and Agroprocess Engineering') THEN 'Food Engineering (FE)'
  WHEN department IN ('ARCH', 'Architecture') THEN 'Architecture (ARCH)'
  WHEN department IN ('ESDM', 'Environmental Science and Disaster Management') THEN 'Environmental Science and Disaster Management (ESDM)'
  WHEN department IN ('BGE', 'Biotechnology and Genetic Engineering') THEN 'Biotechnology and Genetic Engineering (BGE)'
  WHEN department IN ('BMB', 'Biochemistry and Molecular Biology') THEN 'Biochemistry and Molecular Biology (BMB)'
  WHEN department IN ('PAD', 'Public Administration') THEN 'Public Administration (PAD)'
  WHEN department IN ('IR', 'International Relations') THEN 'International Relations (IR)'
  WHEN department IN ('PS', 'Political Science') THEN 'Political Science (PS)'
  WHEN department IN ('AIS', 'Accounting and Information Systems') THEN 'Accounting and Information Systems (AIS)'
  WHEN department IN ('THM', 'Tourism and Hospitality Management') THEN 'Tourism and Hospitality Management (THM)'
  WHEN department IN ('FMB', 'Fisheries and Marine Bioscience') THEN 'Fisheries and Marine Bioscience (FMB)'
  WHEN department IN ('ASVM', 'Animal Science and Veterinary Medicine') THEN 'Animal Science and Veterinary Medicine (ASVM)'
  ELSE department
END;

UPDATE courses
SET dept = CASE
  WHEN dept IN ('CSE', 'Computer Science and Engineering') THEN 'Computer Science and Engineering (CSE)'
  WHEN dept IN ('EEE', 'Electrical and Electronic Engineering') THEN 'Electrical and Electronic Engineering (EEE)'
  WHEN dept IN ('ETE', 'Electronics and Telecommunication Engineering') THEN 'Electronics and Telecommunication Engineering (ETE)'
  WHEN dept IN ('ACCE', 'Applied Chemistry and Chemical Engineering') THEN 'Applied Chemistry and Chemical Engineering (ACCE)'
  WHEN dept IN ('CE', 'Civil Engineering') THEN 'Civil Engineering (CE)'
  WHEN dept IN ('FE', 'FAPE', 'Food Engineering', 'Food and Agroprocess Engineering') THEN 'Food Engineering (FE)'
  WHEN dept IN ('ARCH', 'Architecture') THEN 'Architecture (ARCH)'
  WHEN dept IN ('ESDM', 'Environmental Science and Disaster Management') THEN 'Environmental Science and Disaster Management (ESDM)'
  WHEN dept IN ('BGE', 'Biotechnology and Genetic Engineering') THEN 'Biotechnology and Genetic Engineering (BGE)'
  WHEN dept IN ('BMB', 'Biochemistry and Molecular Biology') THEN 'Biochemistry and Molecular Biology (BMB)'
  WHEN dept IN ('PAD', 'Public Administration') THEN 'Public Administration (PAD)'
  WHEN dept IN ('IR', 'International Relations') THEN 'International Relations (IR)'
  WHEN dept IN ('PS', 'Political Science') THEN 'Political Science (PS)'
  WHEN dept IN ('AIS', 'Accounting and Information Systems') THEN 'Accounting and Information Systems (AIS)'
  WHEN dept IN ('THM', 'Tourism and Hospitality Management') THEN 'Tourism and Hospitality Management (THM)'
  WHEN dept IN ('FMB', 'Fisheries and Marine Bioscience') THEN 'Fisheries and Marine Bioscience (FMB)'
  WHEN dept IN ('ASVM', 'Animal Science and Veterinary Medicine') THEN 'Animal Science and Veterinary Medicine (ASVM)'
  ELSE dept
END;

UPDATE config
SET value = CASE
  WHEN `key` = 'department' AND value IN ('CSE', 'Computer Science and Engineering') THEN 'Computer Science and Engineering (CSE)'
  WHEN `key` = 'department' AND value IN ('EEE', 'Electrical and Electronic Engineering') THEN 'Electrical and Electronic Engineering (EEE)'
  WHEN `key` = 'department' AND value IN ('ETE', 'Electronics and Telecommunication Engineering') THEN 'Electronics and Telecommunication Engineering (ETE)'
  WHEN `key` = 'department' AND value IN ('ACCE', 'Applied Chemistry and Chemical Engineering') THEN 'Applied Chemistry and Chemical Engineering (ACCE)'
  WHEN `key` = 'department' AND value IN ('CE', 'Civil Engineering') THEN 'Civil Engineering (CE)'
  WHEN `key` = 'department' AND value IN ('FE', 'FAPE', 'Food Engineering', 'Food and Agroprocess Engineering') THEN 'Food Engineering (FE)'
  WHEN `key` = 'department' AND value IN ('ARCH', 'Architecture') THEN 'Architecture (ARCH)'
  WHEN `key` = 'department' AND value IN ('ESDM', 'Environmental Science and Disaster Management') THEN 'Environmental Science and Disaster Management (ESDM)'
  WHEN `key` = 'department' AND value IN ('BGE', 'Biotechnology and Genetic Engineering') THEN 'Biotechnology and Genetic Engineering (BGE)'
  WHEN `key` = 'department' AND value IN ('BMB', 'Biochemistry and Molecular Biology') THEN 'Biochemistry and Molecular Biology (BMB)'
  WHEN `key` = 'department' AND value IN ('PAD', 'Public Administration') THEN 'Public Administration (PAD)'
  WHEN `key` = 'department' AND value IN ('IR', 'International Relations') THEN 'International Relations (IR)'
  WHEN `key` = 'department' AND value IN ('PS', 'Political Science') THEN 'Political Science (PS)'
  WHEN `key` = 'department' AND value IN ('AIS', 'Accounting and Information Systems') THEN 'Accounting and Information Systems (AIS)'
  WHEN `key` = 'department' AND value IN ('THM', 'Tourism and Hospitality Management') THEN 'Tourism and Hospitality Management (THM)'
  WHEN `key` = 'department' AND value IN ('FMB', 'Fisheries and Marine Bioscience') THEN 'Fisheries and Marine Bioscience (FMB)'
  WHEN `key` = 'department' AND value IN ('ASVM', 'Animal Science and Veterinary Medicine') THEN 'Animal Science and Veterinary Medicine (ASVM)'
  ELSE value
END
WHERE `key` = 'department';

UPDATE class_routines
SET department = CASE
  WHEN department IN ('CSE', 'Computer Science and Engineering') THEN 'Computer Science and Engineering (CSE)'
  WHEN department IN ('EEE', 'Electrical and Electronic Engineering') THEN 'Electrical and Electronic Engineering (EEE)'
  WHEN department IN ('ETE', 'Electronics and Telecommunication Engineering') THEN 'Electronics and Telecommunication Engineering (ETE)'
  WHEN department IN ('ACCE', 'Applied Chemistry and Chemical Engineering') THEN 'Applied Chemistry and Chemical Engineering (ACCE)'
  WHEN department IN ('CE', 'Civil Engineering') THEN 'Civil Engineering (CE)'
  WHEN department IN ('FE', 'FAPE', 'Food Engineering', 'Food and Agroprocess Engineering') THEN 'Food Engineering (FE)'
  WHEN department IN ('ARCH', 'Architecture') THEN 'Architecture (ARCH)'
  WHEN department IN ('ESDM', 'Environmental Science and Disaster Management') THEN 'Environmental Science and Disaster Management (ESDM)'
  WHEN department IN ('BGE', 'Biotechnology and Genetic Engineering') THEN 'Biotechnology and Genetic Engineering (BGE)'
  WHEN department IN ('BMB', 'Biochemistry and Molecular Biology') THEN 'Biochemistry and Molecular Biology (BMB)'
  WHEN department IN ('PAD', 'Public Administration') THEN 'Public Administration (PAD)'
  WHEN department IN ('IR', 'International Relations') THEN 'International Relations (IR)'
  WHEN department IN ('PS', 'Political Science') THEN 'Political Science (PS)'
  WHEN department IN ('AIS', 'Accounting and Information Systems') THEN 'Accounting and Information Systems (AIS)'
  WHEN department IN ('THM', 'Tourism and Hospitality Management') THEN 'Tourism and Hospitality Management (THM)'
  WHEN department IN ('FMB', 'Fisheries and Marine Bioscience') THEN 'Fisheries and Marine Bioscience (FMB)'
  WHEN department IN ('ASVM', 'Animal Science and Veterinary Medicine') THEN 'Animal Science and Veterinary Medicine (ASVM)'
  ELSE department
END;

-- 4. Data Migration: Populate year and season in upload_batches and config
UPDATE upload_batches
SET year = CASE
  WHEN semester REGEXP '[0-9]{4}' THEN CAST(REGEXP_SUBSTR(semester, '[0-9]{4}') AS UNSIGNED)
  ELSE NULL
END
WHERE year IS NULL AND semester REGEXP '[0-9]{4}';

UPDATE upload_batches
SET semester = CASE
  WHEN semester LIKE '%July%' OR semester LIKE '%June-December%' OR semester LIKE '%Fall%' OR semester LIKE '%Autumn%' THEN 'Fall'
  WHEN semester LIKE '%Jan%' OR semester LIKE '%Spring%' OR semester LIKE '%Summer%' THEN 'Spring'
  ELSE semester
END
WHERE semester IS NOT NULL;

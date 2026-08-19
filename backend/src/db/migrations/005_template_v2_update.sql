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

-- 3. Data Migration: Standardize department codes and names in teachers, courses, config, class_routines
UPDATE teachers
SET department = CASE
  WHEN department IN ('CSE', 'Computer Science and Engineering', 'Computer Science and Engineering (CSE)') THEN 'CSE'
  WHEN department IN ('EEE', 'Electrical and Electronic Engineering', 'Electrical and Electronic Engineering (EEE)') THEN 'EEE'
  WHEN department IN ('ETE', 'Electronics and Telecommunication Engineering', 'Electronics and Telecommunication Engineering (ETE)') THEN 'ETE'
  WHEN department IN ('ACCE', 'Applied Chemistry and Chemical Engineering', 'Applied Chemistry and Chemical Engineering (ACCE)') THEN 'ACCE'
  WHEN department IN ('CE', 'Civil Engineering', 'Civil Engineering (CE)') THEN 'CE'
  WHEN department IN ('FE', 'FAPE', 'Food Engineering', 'Food Engineering (FE)', 'Food and Agroprocess Engineering') THEN 'Food and Agroprocess Engineering'
  WHEN department IN ('ARCH', 'Architecture', 'Architecture (ARCH)') THEN 'ARCH'
  WHEN department IN ('ESDM', 'Environmental Science and Disaster Management', 'Environmental Science & Disaster Management', 'Environmental Science and Disaster Management (ESDM)') THEN 'ESDM'
  WHEN department IN ('BGE', 'Biotechnology and Genetic Engineering', 'Biotechnology and Genetic Engineering (BGE)') THEN 'BGE'
  WHEN department IN ('BMB', 'Biochemistry and Molecular Biology', 'Biochemistry and Molecular Biology (BMB)') THEN 'BMB'
  WHEN department IN ('PAD', 'Public Administration', 'Public Administration (PAD)') THEN 'PAD'
  WHEN department IN ('IR', 'International Relations', 'International Relations (IR)') THEN 'IR'
  WHEN department IN ('PS', 'Political Science', 'Political Science (PS)') THEN 'PS'
  WHEN department IN ('AIS', 'Accounting and Information Systems', 'Accounting and Information Systems (AIS)') THEN 'AIS'
  WHEN department IN ('THM', 'Tourism and Hospitality Management', 'Tourism and Hospitality Management (THM)') THEN 'THM'
  WHEN department IN ('FMB', 'Fisheries and Marine Bioscience', 'Fisheries and Marine Bioscience (FMB)') THEN 'FMB'
  WHEN department IN ('ASVM', 'Animal Science and Veterinary Medicine', 'Animal Science and Veterinary Medicine (ASVM)') THEN 'ASVM'
  ELSE department
END;

UPDATE courses
SET dept = CASE
  WHEN dept IN ('CSE', 'Computer Science and Engineering', 'Computer Science and Engineering (CSE)') THEN 'CSE'
  WHEN dept IN ('EEE', 'Electrical and Electronic Engineering', 'Electrical and Electronic Engineering (EEE)') THEN 'EEE'
  WHEN dept IN ('ETE', 'Electronics and Telecommunication Engineering', 'Electronics and Telecommunication Engineering (ETE)') THEN 'ETE'
  WHEN dept IN ('ACCE', 'Applied Chemistry and Chemical Engineering', 'Applied Chemistry and Chemical Engineering (ACCE)') THEN 'ACCE'
  WHEN dept IN ('CE', 'Civil Engineering', 'Civil Engineering (CE)') THEN 'CE'
  WHEN dept IN ('FE', 'FAPE', 'Food Engineering', 'Food Engineering (FE)', 'Food and Agroprocess Engineering') THEN 'Food and Agroprocess Engineering'
  WHEN dept IN ('ARCH', 'Architecture', 'Architecture (ARCH)') THEN 'ARCH'
  WHEN dept IN ('ESDM', 'Environmental Science and Disaster Management', 'Environmental Science & Disaster Management', 'Environmental Science and Disaster Management (ESDM)') THEN 'ESDM'
  WHEN dept IN ('BGE', 'Biotechnology and Genetic Engineering', 'Biotechnology and Genetic Engineering (BGE)') THEN 'BGE'
  WHEN dept IN ('BMB', 'Biochemistry and Molecular Biology', 'Biochemistry and Molecular Biology (BMB)') THEN 'BMB'
  WHEN dept IN ('PAD', 'Public Administration', 'Public Administration (PAD)') THEN 'PAD'
  WHEN dept IN ('IR', 'International Relations', 'International Relations (IR)') THEN 'IR'
  WHEN dept IN ('PS', 'Political Science', 'Political Science (PS)') THEN 'PS'
  WHEN dept IN ('AIS', 'Accounting and Information Systems', 'Accounting and Information Systems (AIS)') THEN 'AIS'
  WHEN dept IN ('THM', 'Tourism and Hospitality Management', 'Tourism and Hospitality Management (THM)') THEN 'THM'
  WHEN dept IN ('FMB', 'Fisheries and Marine Bioscience', 'Fisheries and Marine Bioscience (FMB)') THEN 'FMB'
  WHEN dept IN ('ASVM', 'Animal Science and Veterinary Medicine', 'Animal Science and Veterinary Medicine (ASVM)') THEN 'ASVM'
  ELSE dept
END;

UPDATE config
SET value = CASE
  WHEN `key` = 'department' AND value IN ('CSE', 'Computer Science and Engineering', 'Computer Science and Engineering (CSE)') THEN 'CSE'
  WHEN `key` = 'department' AND value IN ('EEE', 'Electrical and Electronic Engineering', 'Electrical and Electronic Engineering (EEE)') THEN 'EEE'
  WHEN `key` = 'department' AND value IN ('ETE', 'Electronics and Telecommunication Engineering', 'Electronics and Telecommunication Engineering (ETE)') THEN 'ETE'
  WHEN `key` = 'department' AND value IN ('ACCE', 'Applied Chemistry and Chemical Engineering', 'Applied Chemistry and Chemical Engineering (ACCE)') THEN 'ACCE'
  WHEN `key` = 'department' AND value IN ('CE', 'Civil Engineering', 'Civil Engineering (CE)') THEN 'CE'
  WHEN `key` = 'department' AND value IN ('FE', 'FAPE', 'Food Engineering', 'Food Engineering (FE)', 'Food and Agroprocess Engineering') THEN 'Food and Agroprocess Engineering'
  WHEN `key` = 'department' AND value IN ('ARCH', 'Architecture', 'Architecture (ARCH)') THEN 'ARCH'
  WHEN `key` = 'department' AND value IN ('ESDM', 'Environmental Science and Disaster Management', 'Environmental Science & Disaster Management', 'Environmental Science and Disaster Management (ESDM)') THEN 'ESDM'
  WHEN `key` = 'department' AND value IN ('BGE', 'Biotechnology and Genetic Engineering', 'Biotechnology and Genetic Engineering (BGE)') THEN 'BGE'
  WHEN `key` = 'department' AND value IN ('BMB', 'Biochemistry and Molecular Biology', 'Biochemistry and Molecular Biology (BMB)') THEN 'BMB'
  WHEN `key` = 'department' AND value IN ('PAD', 'Public Administration', 'Public Administration (PAD)') THEN 'PAD'
  WHEN `key` = 'department' AND value IN ('IR', 'International Relations', 'International Relations (IR)') THEN 'IR'
  WHEN `key` = 'department' AND value IN ('PS', 'Political Science', 'Political Science (PS)') THEN 'PS'
  WHEN `key` = 'department' AND value IN ('AIS', 'Accounting and Information Systems', 'Accounting and Information Systems (AIS)') THEN 'AIS'
  WHEN `key` = 'department' AND value IN ('THM', 'Tourism and Hospitality Management', 'Tourism and Hospitality Management (THM)') THEN 'THM'
  WHEN `key` = 'department' AND value IN ('FMB', 'Fisheries and Marine Bioscience', 'Fisheries and Marine Bioscience (FMB)') THEN 'FMB'
  WHEN `key` = 'department' AND value IN ('ASVM', 'Animal Science and Veterinary Medicine', 'Animal Science and Veterinary Medicine (ASVM)') THEN 'ASVM'
  ELSE value
END
WHERE `key` = 'department';

UPDATE class_routines
SET department = CASE
  WHEN department IN ('CSE', 'Computer Science and Engineering', 'Computer Science and Engineering (CSE)') THEN 'CSE'
  WHEN department IN ('EEE', 'Electrical and Electronic Engineering', 'Electrical and Electronic Engineering (EEE)') THEN 'EEE'
  WHEN department IN ('ETE', 'Electronics and Telecommunication Engineering', 'Electronics and Telecommunication Engineering (ETE)') THEN 'ETE'
  WHEN department IN ('ACCE', 'Applied Chemistry and Chemical Engineering', 'Applied Chemistry and Chemical Engineering (ACCE)') THEN 'ACCE'
  WHEN department IN ('CE', 'Civil Engineering', 'Civil Engineering (CE)') THEN 'CE'
  WHEN department IN ('FE', 'FAPE', 'Food Engineering', 'Food Engineering (FE)', 'Food and Agroprocess Engineering') THEN 'Food and Agroprocess Engineering'
  WHEN department IN ('ARCH', 'Architecture', 'Architecture (ARCH)') THEN 'ARCH'
  WHEN department IN ('ESDM', 'Environmental Science and Disaster Management', 'Environmental Science & Disaster Management', 'Environmental Science and Disaster Management (ESDM)') THEN 'ESDM'
  WHEN department IN ('BGE', 'Biotechnology and Genetic Engineering', 'Biotechnology and Genetic Engineering (BGE)') THEN 'BGE'
  WHEN department IN ('BMB', 'Biochemistry and Molecular Biology', 'Biochemistry and Molecular Biology (BMB)') THEN 'BMB'
  WHEN department IN ('PAD', 'Public Administration', 'Public Administration (PAD)') THEN 'PAD'
  WHEN department IN ('IR', 'International Relations', 'International Relations (IR)') THEN 'IR'
  WHEN department IN ('PS', 'Political Science', 'Political Science (PS)') THEN 'PS'
  WHEN department IN ('AIS', 'Accounting and Information Systems', 'Accounting and Information Systems (AIS)') THEN 'AIS'
  WHEN department IN ('THM', 'Tourism and Hospitality Management', 'Tourism and Hospitality Management (THM)') THEN 'THM'
  WHEN department IN ('FMB', 'Fisheries and Marine Bioscience', 'Fisheries and Marine Bioscience (FMB)') THEN 'FMB'
  WHEN department IN ('ASVM', 'Animal Science and Veterinary Medicine', 'Animal Science and Veterinary Medicine (ASVM)') THEN 'ASVM'
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

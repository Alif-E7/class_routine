-- Create users table and insert default admin
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'USER',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

INSERT INTO users (email, password_hash, role)
VALUES ('admin_cse@gmail.com', SHA2('12345678', 256), 'ADMIN')
ON DUPLICATE KEY UPDATE password_hash = SHA2('12345678', 256);

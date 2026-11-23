const mysql = require('mysql2/promise');

function createPool() {
  const required = ['MYSQL_USER', 'MYSQL_DATABASE'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing MySQL configuration: ${missing.join(', ')}. Copy .env.example to .env and configure it.`);
  }

  return mysql.createPool({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
    queueLimit: 0,
    timezone: 'Z',
    dateStrings: true
  });
}

async function initializeSchema(pool) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(80) NOT NULL,
      email VARCHAR(254) NOT NULL,
      password_hash VARCHAR(200) NOT NULL,
      workspace VARCHAR(80) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_users_email (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS projects (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      name VARCHAR(100) NOT NULL,
      client VARCHAR(80) NOT NULL,
      type VARCHAR(40) NOT NULL,
      brief TEXT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'Draft',
      slug VARCHAR(80) NULL,
      content_json LONGTEXT NOT NULL,
      published_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_projects_slug (slug),
      KEY idx_projects_user_updated (user_id, updated_at),
      CONSTRAINT fk_projects_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS integrations (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      project_id BIGINT UNSIGNED NOT NULL,
      name VARCHAR(100) NOT NULL,
      type VARCHAR(40) NOT NULL,
      environment VARCHAR(20) NOT NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'Demo integration',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_integrations_user_created (user_id, created_at),
      CONSTRAINT fk_integrations_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_integrations_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS website_databases (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      project_id BIGINT UNSIGNED NOT NULL,
      name VARCHAR(100) NOT NULL,
      source VARCHAR(16) NOT NULL DEFAULT 'external',
      host VARCHAR(253) NOT NULL,
      port SMALLINT UNSIGNED NOT NULL,
      schema_name VARCHAR(64) NOT NULL,
      username VARCHAR(128) NOT NULL,
      credentials_encrypted TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_website_databases_user_project (user_id, project_id),
      CONSTRAINT fk_website_databases_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_website_databases_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS website_database_tables (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      database_id BIGINT UNSIGNED NOT NULL,
      table_name VARCHAR(63) NOT NULL,
      columns_json TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_website_database_tables_name (database_id, table_name),
      CONSTRAINT fk_website_database_tables_database FOREIGN KEY (database_id) REFERENCES website_databases(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS activity_logs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      project_id BIGINT UNSIGNED NULL,
      action VARCHAR(120) NOT NULL,
      detail VARCHAR(500) NOT NULL DEFAULT '',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_activity_user_created (user_id, created_at),
      CONSTRAINT fk_activity_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_activity_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS submissions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      project_id BIGINT UNSIGNED NOT NULL,
      form_type VARCHAR(30) NOT NULL DEFAULT 'contact',
      name VARCHAR(80) NOT NULL DEFAULT '',
      email VARCHAR(160) NOT NULL,
      message TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_submissions_project_created (project_id, created_at),
      CONSTRAINT fk_submissions_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  ];

  for (const statement of statements) {
    await pool.query(statement);
  }

  const [databaseColumns] = await pool.query('SHOW COLUMNS FROM website_databases');
  if (!databaseColumns.some((column) => column.Field === 'source')) {
    await pool.query("ALTER TABLE website_databases ADD COLUMN source VARCHAR(16) NOT NULL DEFAULT 'external' AFTER name");
  }
  if (databaseColumns.some((column) => column.Field === 'credentials_encrypted' && column.Null === 'NO')) {
    await pool.query('ALTER TABLE website_databases MODIFY credentials_encrypted TEXT NULL');
  }
}

module.exports = { createPool, initializeSchema };
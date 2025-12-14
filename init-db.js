const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function init() {
  console.log(" Connecting to database...");

  const queryCloudSaves = `
    CREATE TABLE IF NOT EXISTS cloud_saves (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      username TEXT NOT NULL,
      save_json TEXT NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT unique_email_username UNIQUE (email, username)
    );
  `;

  const queryCloudLogs = `
    CREATE TABLE IF NOT EXISTS cloud_logs (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      username TEXT NOT NULL,
      device_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `;

  try {
    await pool.query(queryCloudSaves);
    console.log("Table cloud_saves created successfully!");

    await pool.query(queryCloudLogs);
    console.log("Table cloud_logs created successfully!");
  } catch (err) {
    console.error("Error creating table:", err);
  } finally {
    pool.end();
  }
}

init();
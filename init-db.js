const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function init() {
  console.log("Connecting to database...");

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

  // ===== reports =====
  const queryAccountReports = `
    CREATE TABLE IF NOT EXISTS account_reports (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      username TEXT NOT NULL,

      wins_total INT NOT NULL DEFAULT 0,
      losses_total INT NOT NULL DEFAULT 0,

      has_won BOOLEAN NOT NULL DEFAULT FALSE,
      first_win_at TIMESTAMP NULL,

      achievements_count INT NOT NULL DEFAULT 0,

      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

      CONSTRAINT unique_account UNIQUE (email, username)
    );
  `;
  const queryAccountAchievements = `
    CREATE TABLE IF NOT EXISTS account_achievements (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      username TEXT NOT NULL,
      achievement_key TEXT NOT NULL,
      unlocked_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT unique_achievement UNIQUE (email, username, achievement_key)
    );
  `;
  const queryAccountDevices = `
    CREATE TABLE IF NOT EXISTS account_devices (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      username TEXT NOT NULL,
      device_id TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT unique_device UNIQUE (email, username, device_id)
    );
  `;

    // ===== bans / warnings =====
  const queryAccountWarnings = `
    CREATE TABLE IF NOT EXISTS account_warnings (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      username TEXT NOT NULL,
      is_warned BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT unique_account_warning UNIQUE (email, username)
    );
  `;

  const queryDeviceBans = `
    CREATE TABLE IF NOT EXISTS device_bans (
      device_id TEXT PRIMARY KEY,
      is_banned BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `;
  //order và key
    const queryOrders = `
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      order_code TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending', -- pending | paid | cancelled
      amount INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      paid_at TIMESTAMP NULL,
      issued_key TEXT NULL
    );
  `;

  const queryLicenseKeys = `
    CREATE TABLE IF NOT EXISTS license_keys (
      id SERIAL PRIMARY KEY,
      license_key TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      order_id INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'unused', -- unused | activated
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      activated_at TIMESTAMP NULL,
      device_hash TEXT NULL
    );
  `;


  try {
    await pool.query(queryCloudSaves);
    console.log("Table cloud_saves created successfully!");

    await pool.query(queryCloudLogs);
    console.log("Table cloud_logs created successfully!");

    await pool.query(queryAccountReports);
    console.log("Table account_reports created successfully!");

    await pool.query(queryAccountAchievements);
    console.log("Table account_achievements created successfully!");

    await pool.query(queryAccountWarnings);
    console.log("Table account_warnings created successfully!");

    await pool.query(queryDeviceBans);
    console.log("Table device_bans created successfully!");

    await pool.query(queryAccountDevices);
    console.log("Table account_devices created successfully!");

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_account_devices_email_username
      ON account_devices (email, username);
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_account_devices_device_lower
      ON account_devices (LOWER(device_id));
    `);
    console.log("Indexes created successfully!");
    
    await pool.query(queryOrders);
    console.log("Table orders created successfully!");

    await pool.query(queryLicenseKeys);
    console.log("Table license_keys created successfully!");

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_email ON orders (email);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_license_keys_email ON license_keys (email);`);
    console.log("License indexes created successfully!");
    

  } catch (err) {
    console.error("Error creating table:", err);
  } finally {
    pool.end();
  }
}

init();

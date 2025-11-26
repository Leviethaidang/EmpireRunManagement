const express = require("express");
const bodyParser = require("body-parser");
const { Pool } = require("pg");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 4000;

// ===== Middleware =====
app.use(cors());
app.use(bodyParser.json());

// ===== Kết nối PostgreSQL =====
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});


// ===== Route test =====
app.get("/", (req, res) => {
  res.json({ ok: true, service: "CloudSaveServer" });
});

// ====== POST /api/cloud-save/sync ======
// Body: { email, username, saveJson }
app.post("/api/cloud-save/sync", async (req, res) => {
  const { email, username, saveJson } = req.body || {};

  if (!email || !username || !saveJson) {
    return res.status(400).json({
      success: false,
      message: "Missing email, username or saveJson",
    });
  }

   const normalizedEmail = normalizeEmail(email);
  
  try {
    const query = `
      INSERT INTO cloud_saves (email, username, save_json, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (email, username)
      DO UPDATE SET
        save_json = EXCLUDED.save_json,
        updated_at = NOW()
      RETURNING id, updated_at;
    `;

    const values = [normalizedEmail, username, saveJson];
    const result = await pool.query(query, values);

    const row = result.rows[0];

    return res.json({
      success: true,
      id: row.id,
      email: normalizedEmail,
      username,
      updatedAt: row.updated_at,
    });
  } catch (err) {
    logDbError("sync", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error while syncing save",
    });
  }
});

// ====== GET /api/cloud-save/fetch?email=...&username=... ======
app.get("/api/cloud-save/fetch", async (req, res) => {
  const { email, username } = req.query;

  if (!email || !username) {
    return res.status(400).json({
      success: false,
      message: "Missing email or username",
    });
  }
  const normalizedEmail = normalizeEmail(email);
  try {
    const query = `
      SELECT email, username, save_json, updated_at
      FROM cloud_saves
      WHERE email = $1 AND username = $2
      LIMIT 1;
    `;
    const values = [normalizedEmail, username];
    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Save not found",
      });
    }

    const row = result.rows[0];

    return res.json({
      success: true,
      email: row.email,
      username: row.username,
      saveJson: row.save_json,
      updatedAt: row.updated_at,
    });
  } catch (err) {
    logDbError("fetch", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error while fetching save",
    });
  }
});
// ====== GET /api/cloud-save/list-by-email?email=... ======
app.get("/api/cloud-save/list-by-email", async (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({
      success: false,
      message: "Missing email",
    });
  }
  const normalizedEmail = normalizeEmail(email);
  try {
    const query = `
      SELECT username, updated_at
      FROM cloud_saves
      WHERE email = $1
      ORDER BY updated_at DESC;
    `;

    const values = [normalizedEmail];
    const result = await pool.query(query, values);

    const entries = result.rows.map((row) => ({
      username: row.username,
      updatedAt: row.updated_at,
    }));

    return res.json({
      success: true,
      email: normalizedEmail,
      entries,
    });
  } catch (err) {
    logDbError("list-by-email", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error while listing saves",
    });
  }
});

// ===== Helper functions =====
function normalizeEmail(email) {
  if (!email) return "";
  return email.trim().toLowerCase();
}
// Helper log lỗi DB
function logDbError(context, err) {
  console.error(`[DB ERROR] ${context}:`, err.message);
}


// ===== Khởi động server =====
app.listen(PORT, () => {
  console.log(`CloudSaveServer is running on port ${PORT}`);
});

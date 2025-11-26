const express = require("express");
const bodyParser = require("body-parser");
const { Pool } = require("pg");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 4000;

// ===== Middleware =====
app.use(cors());
app.use(bodyParser.json());

app.use(express.static("public"));
// ===== Kết nối PostgreSQL =====
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
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
//===phan danh cho trang admin quan ly=====
// ====== ADMIN APIs ======

// Lấy danh sách email (coi như các "folder")
app.get("/api/admin/emails", async (req, res) => {
  try {
    const query = `
      SELECT 
        email,
        COUNT(*) AS save_count,
        MAX(updated_at) AS latest_updated_at
      FROM cloud_saves
      GROUP BY email
      ORDER BY email ASC;
    `;

    const result = await pool.query(query);

    const emails = result.rows.map((row) => ({
      email: row.email,
      saveCount: Number(row.save_count),
      latestUpdatedAt: row.latest_updated_at,
    }));

    return res.json({
      success: true,
      emails,
    });
  } catch (err) {
    logDbError("admin/emails", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error while listing emails",
    });
  }
});

// Lấy danh sách save (file) theo email
// GET /api/admin/saves?email=...
app.get("/api/admin/saves", async (req, res) => {
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

    const saves = result.rows.map((row) => ({
      username: row.username,
      updatedAt: row.updated_at,
    }));

    return res.json({
      success: true,
      email: normalizedEmail,
      saves,
    });
  } catch (err) {
    logDbError("admin/saves", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error while listing saves",
    });
  }
});

// Xoá toàn bộ save của 1 email (xoá "folder")
// DELETE /api/admin/email/:email
app.delete("/api/admin/email/:email", async (req, res) => {
  const rawEmail = req.params.email;
  if (!rawEmail) {
    return res.status(400).json({
      success: false,
      message: "Missing email",
    });
  }

  const normalizedEmail = normalizeEmail(rawEmail);

  try {
    const query = `
      DELETE FROM cloud_saves
      WHERE email = $1;
    `;
    const values = [normalizedEmail];
    const result = await pool.query(query, values);

    return res.json({
      success: true,
      email: normalizedEmail,
      deletedCount: result.rowCount,
    });
  } catch (err) {
    logDbError("admin/delete-email", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error while deleting email saves",
    });
  }
});

// Xoá 1 save cụ thể (xoá "file")
// DELETE /api/admin/save?email=...&username=...
app.delete("/api/admin/save", async (req, res) => {
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
      DELETE FROM cloud_saves
      WHERE email = $1 AND username = $2;
    `;
    const values = [normalizedEmail, username];
    const result = await pool.query(query, values);

    return res.json({
      success: true,
      email: normalizedEmail,
      username,
      deletedCount: result.rowCount,
    });
  } catch (err) {
    logDbError("admin/delete-save", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error while deleting save",
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
// ===== Route =====
app.get("/status", (req, res) => {
  res.json({ ok: true, service: "CloudSaveServer" });
});

// Trang admin HTML
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});
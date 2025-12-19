if (!process.env.RENDER) {
  require("dotenv").config();
}
//server.js của web admin
const express = require("express");
const bodyParser = require("body-parser");
const { Pool } = require("pg");
const cors = require("cors");
const path = require("path");
const { buildLicenseEmailHtml, buildLicenseEmailText } = require("./emailTemplates");

const app = express();
const PORT = process.env.PORT || 4000;

const MAIN_WEB_API_KEY = process.env.MAIN_WEB_API_KEY || "123";

// ===== Middleware =====
app.use(cors());
app.use(bodyParser.json({ limit: "10mb" }));

app.use(express.static("public"));
// ===== Kết nối PostgreSQL =====
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
// ===== Realtime Log Stream (SSE) =====
const logSseClients = new Set();

function broadcastLogToClients(log) {
  const data = `data: ${JSON.stringify(log)}\n\n`;
  for (const res of logSseClients) {
    try { res.write(data); } catch (_) {}
  }
}

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
// ====== POST /api/cloud-log/add ======
app.post("/api/cloud-log/add", async (req, res) => {
  const { email, username, deviceId, content } = req.body || {};

  if (!email || !username || !deviceId || !content) {
    return res.status(400).json({
      success: false,
      message: "Missing email, username, deviceId or content",
    });
  }

  const normalizedEmail = normalizeEmail(email);

  try {
    const query = `
      INSERT INTO cloud_logs (email, username, device_id, content)
      VALUES ($1, $2, $3, $4)
      RETURNING id, created_at;
    `;

    const values = [normalizedEmail, username, deviceId, content];

    const result = await pool.query(query, values);
    const row = result.rows[0];

    const logItem = {
      id: row.id,
      email: normalizedEmail,
      username,
      deviceId,
      content,
      createdAt: row.created_at,
    };

    broadcastLogToClients(logItem);

    return res.json({
      success: true,
      id: row.id,
      createdAt: row.created_at,
    });
  } catch (err) {
    logDbError("cloud-log/add", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error while adding log",
    });
  }
});
// GET logs with pagination
// /api/admin/logs?limit=20
// /api/admin/logs?limit=20&beforeId=1234  -> lấy các log cũ hơn id 1234
app.get("/api/admin/logs", async (req, res) => {
  const { limit, beforeId } = req.query;

  const safeLimit = Math.min(Math.max(parseInt(limit || "20", 10), 1), 200);
  const before = beforeId ? parseInt(beforeId, 10) : null;

  try {
    let q = `
      SELECT id, email, username, device_id, content, created_at
      FROM cloud_logs
    `;
    const params = [];

    if (Number.isInteger(before)) {
      params.push(before);
      q += ` WHERE id < $${params.length} `;
    }

    params.push(safeLimit);
    q += `
      ORDER BY id DESC
      LIMIT $${params.length};
    `;

    const r = await pool.query(q, params);

    const logs = r.rows.map(x => ({
      id: x.id,
      email: x.email,
      username: x.username,
      deviceId: x.device_id,
      content: x.content,
      createdAt: x.created_at,
    }));

    return res.json({ success: true, logs });
  } catch (err) {
    logDbError("admin/logs", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error while listing logs",
    });
  }
});
//thống kê
// ===== POST /api/report/win =====
app.post("/api/report/win", async (req, res) => {
  const { email, username } = req.body || {};
  if (!email || !username) {
    return res.status(400).json({ success: false, message: "Missing email or username" });
  }

  const normalizedEmail = normalizeEmail(email);
  const client = await pool.connect();
  const deviceId = req.body.deviceId || req.body.device_id || "";
  await upsertAccountDevice(email, username, deviceId);

  try {
    await client.query("BEGIN");

    await ensureAccountReportRow(client, normalizedEmail, username);

    const q = `
      UPDATE account_reports
      SET
        wins_total = wins_total + 1,
        has_won = TRUE,
        first_win_at = COALESCE(first_win_at, NOW()),
        updated_at = NOW()
      WHERE email = $1 AND username = $2
      RETURNING wins_total, has_won, first_win_at;
    `;
    const r = await client.query(q, [normalizedEmail, username]);

    await client.query("COMMIT");
    return res.json({ success: true, report: r.rows[0] });
  } catch (err) {
    await client.query("ROLLBACK");
    logDbError("report/win", err);
    return res.status(500).json({ success: false, message: "Internal server error while reporting win" });
  } finally {
    client.release();
  }
});

// ===== POST /api/report/lose =====
app.post("/api/report/lose", async (req, res) => {
  const { email, username } = req.body || {};
  if (!email || !username) {
    return res.status(400).json({ success: false, message: "Missing email or username" });
  }

  const normalizedEmail = normalizeEmail(email);
  const client = await pool.connect();
  const deviceId = req.body.deviceId || req.body.device_id || "";
  await upsertAccountDevice(email, username, deviceId);

  try {
    await client.query("BEGIN");

    await ensureAccountReportRow(client, normalizedEmail, username);

    const q = `
      UPDATE account_reports
      SET
        losses_total = losses_total + 1,
        updated_at = NOW()
      WHERE email = $1 AND username = $2
      RETURNING losses_total;
    `;
    const r = await client.query(q, [normalizedEmail, username]);

    await client.query("COMMIT");
    return res.json({ success: true, report: r.rows[0] });
  } catch (err) {
    await client.query("ROLLBACK");
    logDbError("report/lose", err);
    return res.status(500).json({ success: false, message: "Internal server error while reporting lose" });
  } finally {
    client.release();
  }
});

// ===== POST /api/report/achievement =====
app.post("/api/report/achievement", async (req, res) => {
  const { email, username, achievementKey } = req.body || {};
  if (!email || !username || !achievementKey) {
    return res.status(400).json({ success: false, message: "Missing email, username, or achievementKey" });
  }

  const normalizedEmail = normalizeEmail(email);
  const key = String(achievementKey).trim();
  const deviceId = req.body.deviceId || req.body.device_id || "";
  await upsertAccountDevice(email, username, deviceId);

  if (!key) {
    return res.status(400).json({ success: false, message: "achievementKey is empty" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await ensureAccountReportRow(client, normalizedEmail, username);

    // insert dedupe
    const ins = `
      INSERT INTO account_achievements (email, username, achievement_key)
      VALUES ($1, $2, $3)
      ON CONFLICT (email, username, achievement_key) DO NOTHING
      RETURNING id;
    `;
    const insR = await client.query(ins, [normalizedEmail, username, key]);

    let added = false;

    if (insR.rows.length > 0) {
      added = true;
      await client.query(
        `
        UPDATE account_reports
        SET
          achievements_count = achievements_count + 1,
          updated_at = NOW()
        WHERE email = $1 AND username = $2;
        `,
        [normalizedEmail, username]
      );
    }

    await client.query("COMMIT");
    return res.json({ success: true, added, achievementKey: key });
  } catch (err) {
    await client.query("ROLLBACK");
    logDbError("report/achievement", err);
    return res.status(500).json({ success: false, message: "Internal server error while reporting achievement" });
  } finally {
    client.release();
  }
});
// ===== Report: register =====
app.post("/api/report/register", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const username = String(req.body.username || "").trim();
    const deviceId = String(req.body.deviceId || req.body.device_id || "").trim();

    if (!email || !username) {
      return res.status(400).json({ success: false, error: "missing_email_or_username" });
    }

    await pool.query(
      `INSERT INTO account_reports (email, username)
       VALUES ($1, $2)
       ON CONFLICT (email, username) DO NOTHING;`,
      [email, username]
    );

    await upsertAccountDevice(email, username, deviceId);

    return res.json({ success: true });
  } catch (err) {
    console.error("POST /api/report/register error:", err);
    return res.status(500).json({ success: false, error: "server_error" });
  }
});
// ===== License Order: Main Web -> Admin Web =====
// Body: { email, orderCode, amount }
app.post("/api/license/order/create", requireMainWebKey, async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const orderCode = String(req.body.orderCode || "").trim();
    const amount = parseInt(req.body.amount || "0", 10) || 0;

    if (!email || !orderCode) {
      return res.status(400).json({ success: false, error: "missing_email_or_orderCode" });
    }

    await pool.query(
      `INSERT INTO orders (email, order_code, amount, status)
       VALUES ($1, $2, $3, 'pending')
       ON CONFLICT (order_code) DO NOTHING;`,
      [email, orderCode, amount]
    );

    return res.json({ success: true });
  } catch (err) {
    logDbError("license/order/create", err);
    return res.status(500).json({ success: false, error: "server_error" });
  }
});


//===Phần dành cho admin=====
// ====== ADMIN APIs ======
// Lấy danh sách email
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

// Lấy danh sách sav theo email
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

// Xoá toàn bộ save của 1 email
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

// Xoá 1 save cụ thể
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
// Realtime stream logs (SSE)
app.get("/api/admin/logs/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  res.write(`data: ${JSON.stringify({ type: "hello", t: Date.now() })}\n\n`);

  logSseClients.add(res);

  req.on("close", () => {
    logSseClients.delete(res);
  });
});
// ===== Admin Reports APIs =====
app.get("/api/admin/reports/summary", async (req, res) => {
  try {
    const q = `
      SELECT
        COUNT(*)::int AS players_total,
        COALESCE(SUM(wins_total), 0)::int AS wins_total,
        COALESCE(SUM(losses_total), 0)::int AS losses_total,
        COALESCE(AVG(achievements_count), 0)::float AS achievements_avg,
        COALESCE(SUM(CASE WHEN has_won THEN 1 ELSE 0 END), 0)::int AS players_won
      FROM account_reports;
    `;

    const result = await pool.query(q);
    const row = result.rows[0] || {};

    const playersTotal = row.players_total || 0;
    const playersWon = row.players_won || 0;

    const completionRate = playersTotal > 0 ? (playersWon / playersTotal) : 0;

    return res.json({
      success: true,
      summary: {
        playersTotal,
        playersWon,
        completionRate, // 0..1
        winsTotal: row.wins_total || 0,
        lossesTotal: row.losses_total || 0,
        achievementsAvg: row.achievements_avg || 0,
      },
    });
  } catch (err) {
    console.error("GET /api/admin/reports/summary error:", err);
    return res.status(500).json({ success: false, error: "server_error" });
  }
});

// Player list
app.get("/api/admin/reports/players", async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(parseInt(req.query.limit || "50", 10), 200));
    const offset = Math.max(0, parseInt(req.query.offset || "0", 10));
    const qStr = String(req.query.q || "").trim().toLowerCase();
    const q = qStr; // đã lower để match deviceId dễ hơn

    const query = `
      SELECT
        ar.email,
        ar.username,
        ar.wins_total,
        ar.losses_total,
        ar.achievements_count,
        COALESCE(dev.device_count, 0) AS device_count
      FROM account_reports ar
      LEFT JOIN (
        SELECT email, username, COUNT(*)::int AS device_count
        FROM account_devices
        GROUP BY email, username
      ) dev
        ON dev.email = ar.email AND dev.username = ar.username
      WHERE
        ($1 = '' OR
          ar.email ILIKE '%' || $1 || '%' OR
          ar.username ILIKE '%' || $1 || '%' OR
          EXISTS (
            SELECT 1
            FROM account_devices ad
            WHERE ad.email = ar.email
              AND ad.username = ar.username
              AND LOWER(ad.device_id) LIKE '%' || $1 || '%'
          )
        )
      ORDER BY ar.updated_at DESC
      LIMIT $2 OFFSET $3;
    `;

    const result = await pool.query(query, [q, limit, offset]);
    return res.json({ success: true, players: result.rows });
  } catch (err) {
    console.error("GET /api/admin/reports/players error:", err);
    return res.status(500).json({ success: false, error: "server_error" });
  }
});



// Detail
app.get("/api/admin/reports/detail", async (req, res) => {
  try {
    const email = String(req.query.email || "").trim().toLowerCase();
    const username = String(req.query.username || "").trim();

    if (!email || !username) {
      return res.status(400).json({ success: false, error: "missing_email_or_username" });
    }

    // 1) lấy report
    const r1 = await pool.query(
      `SELECT *
       FROM account_reports
       WHERE email = $1 AND username = $2
       LIMIT 1;`,
      [email, username]
    );

    const row = r1.rows[0];
    if (!row) return res.json({ success: true, report: null });

    // 2) lấy danh sách device
    const devR = await pool.query(
      `SELECT device_id
       FROM account_devices
       WHERE email = $1 AND username = $2
       ORDER BY created_at ASC;`,
      [row.email, row.username]
    );

    const deviceIds = devR.rows.map(x => x.device_id);
    
    // 3) lấy danh sách achievements
    const achR = await pool.query(
      `SELECT achievement_key
      FROM account_achievements
      WHERE email = $1 AND username = $2
      ORDER BY unlocked_at ASC;`,
      [row.email, row.username]
    );
    const achKeys = achR.rows.map(x => x.achievement_key);

    row.device_ids = deviceIds;
    row.device_count = deviceIds.length;
    row.achievement_ids = achKeys;

    return res.json({ success: true, report: row });
  } catch (err) {
    console.error("GET /api/admin/reports/detail error:", err);
    return res.status(500).json({ success: false, error: "server_error" });
  }
});

// ===== Admin Ban/Warn APIs =====

// Search players by email/username/deviceId -> list (player + device + warn + ban)
app.get("/api/admin/ban/search", async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(parseInt(req.query.limit || "100", 10), 500));
    const qStr = String(req.query.q || "").trim().toLowerCase();

    const q = `
      SELECT
        ad.email,
        ad.username,
        ad.device_id,
        COALESCE(aw.is_warned, FALSE) AS is_warned,
        COALESCE(db.is_banned, FALSE) AS is_banned
      FROM account_devices ad
      LEFT JOIN account_warnings aw
        ON aw.email = ad.email AND aw.username = ad.username
      LEFT JOIN device_bans db
        ON db.device_id = ad.device_id
      WHERE
        ($1 = '' OR
          ad.email ILIKE '%' || $1 || '%' OR
          ad.username ILIKE '%' || $1 || '%' OR
          LOWER(ad.device_id) LIKE '%' || $1 || '%'
        )
      ORDER BY ad.email ASC, ad.username ASC, ad.device_id ASC
      LIMIT $2;
    `;

    const r = await pool.query(q, [qStr, limit]);

    const items = r.rows.map(x => ({
      email: x.email,
      username: x.username,
      deviceId: x.device_id,
      isWarned: !!x.is_warned,
      isBanned: !!x.is_banned,
    }));

    return res.json({ success: true, items });
  } catch (err) {
    console.error("GET /api/admin/ban/search error:", err);
    return res.status(500).json({ success: false, error: "server_error" });
  }
});

// Warn a device -> set warn=true for ALL accounts that ever used this device
app.post("/api/admin/ban/warn-device", async (req, res) => {
  try {
    const deviceId = String(req.body.deviceId || "").trim();
    if (!deviceId) return res.status(400).json({ success: false, error: "missing_deviceId" });

    const qAccounts = `
      SELECT DISTINCT email, username
      FROM account_devices
      WHERE device_id = $1;
    `;
    const acc = await pool.query(qAccounts, [deviceId]);

    if (acc.rows.length === 0) {
      return res.json({ success: true, affectedAccounts: 0 });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      for (const row of acc.rows) {
        await client.query(
          `
          INSERT INTO account_warnings (email, username, is_warned, updated_at)
          VALUES ($1, $2, TRUE, NOW())
          ON CONFLICT (email, username)
          DO UPDATE SET is_warned = TRUE, updated_at = NOW();
          `,
          [row.email, row.username]
        );
      }

      await client.query("COMMIT");
      return res.json({ success: true, affectedAccounts: acc.rows.length });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("POST /api/admin/ban/warn-device error:", err);
    return res.status(500).json({ success: false, error: "server_error" });
  }
});

// Clear warning for a specific account (admin tool)
app.post("/api/admin/ban/clear-warn", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const username = String(req.body.username || "").trim();
    if (!email || !username) return res.status(400).json({ success: false, error: "missing_email_or_username" });

    const q = `
      INSERT INTO account_warnings (email, username, is_warned, updated_at)
      VALUES ($1, $2, FALSE, NOW())
      ON CONFLICT (email, username)
      DO UPDATE SET is_warned = FALSE, updated_at = NOW();
    `;
    await pool.query(q, [email, username]);

    return res.json({ success: true });
  } catch (err) {
    console.error("POST /api/admin/ban/clear-warn error:", err);
    return res.status(500).json({ success: false, error: "server_error" });
  }
});

// Ban/unban a device
app.post("/api/admin/ban/set-ban", async (req, res) => {
  try {
    const deviceId = String(req.body.deviceId || "").trim();
    const isBanned = !!req.body.isBanned;

    if (!deviceId) return res.status(400).json({ success: false, error: "missing_deviceId" });

    const q = `
      INSERT INTO device_bans (device_id, is_banned, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (device_id)
      DO UPDATE SET is_banned = $2, updated_at = NOW();
    `;
    await pool.query(q, [deviceId, isBanned]);

    return res.json({ success: true, deviceId, isBanned });
  } catch (err) {
    console.error("POST /api/admin/ban/set-ban error:", err);
    return res.status(500).json({ success: false, error: "server_error" });
  }
});

// Approve order -> generate license key -> save DB -> send email
app.post("/api/admin/orders/approve", async (req, res) => {
  const id = parseInt(req.body.id || "0", 10);
  if (!id) return res.status(400).json({ success: false, error: "missing_id" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const o = await client.query(
      `SELECT id, email, order_code, status, issued_key
       FROM orders
       WHERE id = $1
       FOR UPDATE;`,
      [id]
    );

    if (o.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, error: "order_not_found" });
    }

    const order = o.rows[0];

    if (order.status !== "pending") {
      await client.query("ROLLBACK");
      return res.json({
        success: true,
        message: "order_not_pending",
        issuedKey: order.issued_key || null,
      });
    }

    // key đã tồn tại thì dùng lại
    let key = order.issued_key;

    if (!key) {
      for (let attempt = 0; attempt < 10; attempt++) {
        const candidate = generateLicenseKey10();
        const exists = await client.query(
          `SELECT 1 FROM license_keys WHERE license_key = $1 LIMIT 1;`,
          [candidate]
        );
        if (exists.rows.length === 0) {
          key = candidate;
          break;
        }
      }
      if (!key) throw new Error("failed_to_generate_unique_key");
    }

    // upsert license_keys
    await client.query(
      `INSERT INTO license_keys (license_key, email, order_id, status)
       VALUES ($1, $2, $3, 'unused')
       ON CONFLICT (license_key) DO NOTHING;`,
      [key, order.email, order.id]
    );

    // update order nhưng CHƯA commit vội
    await client.query(
      `UPDATE orders
       SET status='paid', paid_at=NOW(), issued_key=$2
       WHERE id=$1;`,
      [order.id, key]
    );

    // GỬI MAIL TRƯỚC
    try {
      await sendLicenseKeyEmail(order.email, key, order.order_code);
    } catch (mailErr) {
      console.error("[MAIL ERROR] approve failed:", mailErr?.message || mailErr);
      await client.query("ROLLBACK");
      return res.status(500).json({ success: false, error: "mail_failed" });
    }

    await client.query("COMMIT");

    return res.json({ success: true, issuedKey: key, email: order.email });
  } catch (err) {
    await client.query("ROLLBACK");
    logDbError("admin/orders/approve", err);
    return res.status(500).json({ success: false, error: "server_error" });
  } finally {
    client.release();
  }
});



// ===== Unity APIs =====

// Check status on login: ban by deviceId, warn by account (email+username)
app.get("/api/device/status", async (req, res) => {
  try {
    const email = normalizeEmail(req.query.email);
    const username = String(req.query.username || "").trim();
    const deviceId = String(req.query.deviceId || "").trim();

    if (!email || !username || !deviceId) {
      return res.status(400).json({ success: false, error: "missing_email_username_deviceId" });
    }

    const banR = await pool.query(
      `SELECT is_banned FROM device_bans WHERE device_id = $1 LIMIT 1;`,
      [deviceId]
    );
    const isBanned = banR.rows.length ? !!banR.rows[0].is_banned : false;

    const warnR = await pool.query(
      `SELECT is_warned FROM account_warnings WHERE email = $1 AND username = $2 LIMIT 1;`,
      [email, username]
    );
    const isWarned = warnR.rows.length ? !!warnR.rows[0].is_warned : false;

    return res.json({ success: true, isBanned, isWarned });
  } catch (err) {
    console.error("GET /api/device/status error:", err);
    return res.status(500).json({ success: false, error: "server_error" });
  }
});

// Ack warning (Unity after showing warning panel): set warn=false for account
app.post("/api/device/warn/ack", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const username = String(req.body.username || "").trim();

    if (!email || !username) {
      return res.status(400).json({ success: false, error: "missing_email_or_username" });
    }

    const q = `
      INSERT INTO account_warnings (email, username, is_warned, updated_at)
      VALUES ($1, $2, FALSE, NOW())
      ON CONFLICT (email, username)
      DO UPDATE SET is_warned = FALSE, updated_at = NOW();
    `;
    await pool.query(q, [email, username]);

    return res.json({ success: true });
  } catch (err) {
    console.error("POST /api/device/warn/ack error:", err);
    return res.status(500).json({ success: false, error: "server_error" });
  }
});
// Unity activate key (one-time)
// Body: { key }
app.post("/api/unity/license/activate", async (req, res) => {
  const key = String(req.body.key || "").trim().toUpperCase();
  if (!key) return res.status(400).json({ success: false, error: "missing_key" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock key row to avoid double activation
    const r = await client.query(
      `SELECT id, status
       FROM license_keys
       WHERE license_key = $1
       FOR UPDATE;`,
      [key]
    );

    if (r.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.json({ success: true, valid: false, reason: "not_found" });
    }

    const row = r.rows[0];

    if (row.status === "activated") {
      await client.query("ROLLBACK");
      return res.json({ success: true, valid: false, reason: "already_activated" });
    }

    // Activate now
    await client.query(
      `UPDATE license_keys
       SET status='activated', activated_at=NOW()
       WHERE id=$1;`,
      [row.id]
    );

    await client.query("COMMIT");
    return res.json({ success: true, valid: true });
  } catch (err) {
    await client.query("ROLLBACK");
    logDbError("unity/license/activate", err);
    return res.status(500).json({ success: false, error: "server_error" });
  } finally {
    client.release();
  }
});
// Lấy danh sách order theo status (pending)
app.get("/api/admin/orders", async (req, res) => {
  try {
    const status = String(req.query.status || "").trim();

    if (!status) {
      return res.status(400).json({ success: false, error: "missing_status" });
    }

    const r = await pool.query(
      `SELECT id, email, order_code, status, created_at
       FROM orders
       WHERE status = $1
       ORDER BY created_at ASC;`,
      [status]
    );

    return res.json({ success: true, orders: r.rows });
  } catch (err) {
    logDbError("admin/orders/list", err);
    return res.status(500).json({ success: false, error: "server_error" });
  }
});

// Huỷ (xoá) order đang chờ
app.post("/api/admin/orders/cancel", async (req, res) => {
  const id = parseInt(req.body.id || "0", 10);
  if (!id) return res.status(400).json({ success: false, error: "missing_id" });

  try {
    const r = await pool.query(
      `DELETE FROM orders
       WHERE id = $1 AND status = 'pending'
       RETURNING id;`,
      [id]
    );

    if (r.rowCount === 0) {
      return res.json({ success: false, error: "order_not_found_or_not_pending" });
    }

    return res.json({ success: true });
  } catch (err) {
    logDbError("admin/orders/cancel", err);
    return res.status(500).json({ success: false, error: "server_error" });
  }
});



// ===== Helper functions =====
function normalizeEmail(email) {
  if (!email) return "";
  return email.trim().toLowerCase();
}
// Helper log lỗi DB
function logDbError(context, err) {
  console.error(`[DB ERROR] ${context}:`, err);
}

function requireMainWebKey(req, res, next) {
  const key = String(req.headers["x-api-key"] || "");
  if (!MAIN_WEB_API_KEY || key !== MAIN_WEB_API_KEY) {
    return res.status(401).json({ success: false, error: "unauthorized" });
  }
  next();
}

async function sendLicenseKeyEmail(toEmail, key, orderCode) {
  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.SENDGRID_FROM;

  if (!apiKey) throw new Error("missing_SENDGRID_API_KEY");
  if (!fromEmail) throw new Error("missing_SENDGRID_FROM");
  if (!toEmail) throw new Error("missing_toEmail");

  const subject = "Your Empire Run License Key";
  const html = buildLicenseEmailHtml(orderCode, key);
  const text = buildLicenseEmailText(orderCode, key);

  // SendGrid v3 Mail Send API
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: toEmail }] }],
      from: { email: fromEmail, name: "Empire Run" },
      subject,
      content: [
        { type: "text/plain", value: text },
        { type: "text/html", value: html },
      ],
    }),
  });

  // SendGrid trả 202 là accepted (gửi OK)
  if (res.status === 202) return { ok: true };

  // lỗi thì đọc text để show message, rồi throw để route approve rollback
  const errText = await res.text();
  let data = {};
  try { data = JSON.parse(errText); } catch { data = { raw: errText }; }

  const msg =
    (data?.errors && data.errors[0]?.message) ||
    data?.message ||
    `SendGrid HTTP ${res.status}`;

  throw new Error(msg);
}

function generateLicenseKey10() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 10; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}



// đảm bảo luôn có row trong account_reports
async function ensureAccountReportRow(client, email, username) {
  const q = `
    INSERT INTO account_reports (email, username)
    VALUES ($1, $2)
    ON CONFLICT (email, username) DO NOTHING;
  `;
  await client.query(q, [email, username]);
}
// thêm thiết bị vào account_devices
async function upsertAccountDevice(email, username, deviceId) {
  const e = String(email || "").trim().toLowerCase();
  const u = String(username || "").trim();
  const d = String(deviceId || "").trim();

  if (!e || !u || !d) return;

  // dedupe nhờ UNIQUE(email, username, device_id)
  await pool.query(
    `INSERT INTO account_devices (email, username, device_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (email, username, device_id) DO NOTHING;`,
    [e, u, d]
  );
}

//test ket noi db
app.get("/db-status", async (req, res) => {
  try {
    const r = await pool.query("SELECT NOW() AS now;");
    res.json({ ok: true, now: r.rows[0].now });
  } catch (err) {
    logDbError("db-status", err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});
//test list order
app.get("/api/admin/orders/test", async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, email, order_code, status, created_at
       FROM orders
       ORDER BY created_at DESC
       LIMIT 10;`
    );
    res.json({ success: true, orders: r.rows });
  } catch (err) {
    logDbError("orders/test", err);
    res.status(500).json({ success: false });
  }
});
//test list license keys
app.get("/api/admin/license-keys", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || "200", 10) || 200, 500);

    const r = await pool.query(
      `SELECT id, license_key, status, created_at, activated_at
       FROM license_keys
       ORDER BY id DESC
       LIMIT $1;`,
      [limit]
    );

    // trả thêm isActivated cho UI dễ dùng
    const keys = r.rows.map(k => ({
      id: k.id,
      key: k.license_key,
      status: k.status,              // 'unused' | 'activated'
      isActivated: k.status === "activated",
      createdAt: k.created_at,
      activatedAt: k.activated_at,
    }));

    return res.json({ success: true, keys });
  } catch (err) {
    logDbError("admin/license-keys", err);
    return res.status(500).json({ success: false, error: "server_error" });
  }
});


// ===== Khởi động server =====
app.listen(PORT, () => {
  console.log(`EmpireRunServices running at http://localhost:${PORT}`);
});
// ===== Route =====
app.get("/status", (req, res) => {
  res.json({ ok: true, service: "EmpireRunServices" });
});

// Pages
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "players.html"));
});

app.get("/saves", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "saves.html"));
});

app.get("/players", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "players.html"));
});

app.get("/ban", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "ban.html"));
});

app.get("/licenses", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "licenses.html"));
});
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import pkg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const { Pool } = pkg;
const region = "us-east-1";
const sm = new SecretsManagerClient({ region });

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let pool = null;

/**
 * Get database configuration from AWS Secrets Manager
 */
async function getDbConfig() {
  const dbSecretArn = process.env.DB_SECRET_ARN || "menu-db";
  const secretResponse = await sm.send(new GetSecretValueCommand({ SecretId: dbSecretArn }));

  if (!secretResponse.SecretString) {
    throw new Error("SecretString is empty");
  }

  return JSON.parse(secretResponse.SecretString);
}

/**
 * Get or create database connection pool
 */
export async function getPool() {
  if (pool) {
    return pool;
  }

  const dbConfig = await getDbConfig();

  pool = new Pool({
    host: dbConfig.host,
    user: dbConfig.username,
    password: dbConfig.password,
    database: dbConfig.dbname,
    port: dbConfig.port,
    ssl: { rejectUnauthorized: false },
    max: 10, // Maximum number of clients in the pool
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  pool.on("error", (err) => {
    console.error("Unexpected pool error:", err);
  });

  return pool;
}

/**
 * Execute a query
 */
export async function query(text, params) {
  const pool = await getPool();
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log("Executed query", { text, duration, rows: res.rowCount });
    return res;
  } catch (error) {
    console.error("Query error:", error.message, { text, params });
    throw error;
  }
}

/**
 * Initialize database with schema
 */
export async function initializeDatabase() {
  try {
    const dbConfig = await getDbConfig();

    // First, ensure the database exists
    const adminPool = new Pool({
      host: dbConfig.host,
      user: dbConfig.username,
      password: dbConfig.password,
      database: "postgres", // Connect to default database
      port: dbConfig.port,
      ssl: { rejectUnauthorized: false },
    });

    // Check if database exists, create if not
    const dbCheckResult = await adminPool.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [dbConfig.dbname]
    );

    if (dbCheckResult.rows.length === 0) {
      console.log(`Creating database: ${dbConfig.dbname}`);
      await adminPool.query(`CREATE DATABASE "${dbConfig.dbname}"`);
    }

    await adminPool.end();

    // Now connect to our application database and run schema
    const schemaPath = path.join(__dirname, "schema.sql");
    const schemaSql = fs.readFileSync(schemaPath, "utf8");

    const appPool = await getPool();
    await appPool.query(schemaSql);

    console.log("Database initialized successfully");
    return { success: true, message: "Database initialized successfully" };
  } catch (error) {
    console.error("Database initialization error:", error);
    throw error;
  }
}

/**
 * Create or update user record
 */
export async function upsertUser(userId, email) {
  const result = await query(
    `INSERT INTO users (user_id, email)
     VALUES ($1, $2)
     ON CONFLICT (user_id)
     DO UPDATE SET email = $2, updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [userId, email]
  );
  return result.rows[0];
}

/**
 * Create upload record
 */
export async function createUpload(userId, fileUrl, fileName, s3Key, fileSize, mimeType) {
  const result = await query(
    `INSERT INTO uploads (user_id, file_url, file_name, s3_key, file_size, mime_type)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [userId, fileUrl, fileName, s3Key, fileSize, mimeType]
  );
  return result.rows[0];
}

/**
 * Get user's upload history
 */
export async function getUserUploads(userId, limit = 50) {
  const result = await query(
    `SELECT * FROM uploads
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return result.rows;
}

/**
 * Update OCR status for an upload
 * @param {string} uploadId - Upload UUID
 * @param {string} status - Status: pending | processing | completed | failed
 * @param {number} itemsCount - Number of items extracted (default 0)
 * @param {string} errorMessage - Error message if failed (default null)
 */
export async function updateOcrStatus(uploadId, status, itemsCount = 0, errorMessage = null) {
  const pool = await getPool();

  const updates = [];
  const values = [];
  let paramIndex = 1;

  updates.push(`ocr_status = $${paramIndex++}`);
  values.push(status);

  if (status === 'processing') {
    updates.push(`ocr_started_at = $${paramIndex++}`);
    values.push(new Date());
  }

  if (status === 'completed' || status === 'failed') {
    updates.push(`ocr_completed_at = $${paramIndex++}`);
    values.push(new Date());
  }

  if (status === 'completed') {
    updates.push(`items_count = $${paramIndex++}`);
    values.push(itemsCount);
  }

  if (status === 'failed' && errorMessage) {
    updates.push(`ocr_error = $${paramIndex++}`);
    values.push(errorMessage);
  }

  values.push(uploadId);

  const query = `
    UPDATE uploads
    SET ${updates.join(', ')}, updated_at = NOW()
    WHERE upload_id = $${paramIndex}
  `;

  await pool.query(query, values);
}

/**
 * Save menu items to database
 * @param {string} uploadId - Upload UUID
 * @param {Array} items - Menu items from OCR
 */
export async function saveMenuItems(uploadId, items) {
  const pool = await getPool();

  for (const item of items) {
    await pool.query(
      `INSERT INTO menu_items
       (upload_id, item_name, price, description, category, bbox, confidence_score, notes, extracted_text)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        uploadId,
        item.name,
        item.price,
        item.description || null,
        item.category || null,
        JSON.stringify(item.bbox),
        item.confidence || null,
        item.notes || null,
        JSON.stringify(item) // Store full item as backup in extracted_text
      ]
    );
  }
}

/**
 * Close the pool (for cleanup)
 */
export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

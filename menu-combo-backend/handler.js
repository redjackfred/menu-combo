import serverless from "serverless-http";
import express from "express";
import cors from "cors";
import fileUpload from "express-fileupload";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import pkg from "pg";
import { verifyToken } from "./middleware/auth.js";
import { initializeDatabase, upsertUser, createUpload, getUserUploads } from "./db/index.js";

const { Client } = pkg;
const app = express();
const region = "us-east-1";

// AWS Clients
const s3 = new S3Client({ region });
const sm = new SecretsManagerClient({ region });
const sqsClient = new SQSClient({ region: 'us-east-1' });

// Middleware
app.use(fileUpload());
app.use(
  cors({
    origin: ["https://menu-combo.peiwen.dev", "http://localhost:5173"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// Handle OPTIONS preflight requests
app.options("*", cors());

// --- Root test ---
app.get("/", async (req, res) => {
  try {
    console.log("Root route hit");
    res.json({ message: "Hello from root!" });
  } catch (err) {
    console.error("Root route error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/hello", (req, res) => res.json({ message: "Hello from path!" }));

// --- Initialize Database ---
app.get("/init-db", async (req, res) => {
  try {
    const result = await initializeDatabase();
    res.status(200).json(result);
  } catch (err) {
    console.error("Database initialization error:", err);
    res.status(500).json({ error: "Failed to initialize database", details: err.message });
  }
});

// --- SecretsManager test ---
app.get("/testsecret", async (req, res) => {
  try {
    const dbSecretArn = process.env.DB_SECRET_ARN || "menu-db";
    const claudeSecretArn = process.env.CLAUDE_API_KEY || "menu-claude-api-key";

    const [dbSecret, claudeSecret] = await Promise.all([
      sm.send(new GetSecretValueCommand({ SecretId: dbSecretArn })),
      sm.send(new GetSecretValueCommand({ SecretId: claudeSecretArn })),
    ]);

    const dbConfig = JSON.parse(dbSecret.SecretString);
    const claudeKey = JSON.parse(claudeSecret.SecretString).api_key;

    res.status(200).json({
      message: "Secrets fetched successfully",
      dbHost: dbConfig.host,
      claudeKeySample: claudeKey.slice(0, 6) + "...",
    });
  } catch (err) {
    console.error("Error fetching secrets:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- Upload route (Protected) - Supports multiple files (max 5) ---
app.post("/upload", verifyToken, async (req, res) => {
  try {
    if (!req.files || !req.files.images) {
      return res.status(400).json({ error: "No images uploaded" });
    }

    const bucketName = process.env.BUCKET_NAME;
    const userId = req.user.sub;
    const userEmail = req.user.email;

    // Ensure user exists in database
    await upsertUser(userId, userEmail);

    // Handle both single and multiple files
    let files = req.files.images;
    if (!Array.isArray(files)) {
      files = [files]; // Convert single file to array
    }

    // Limit to 5 files
    if (files.length > 5) {
      return res.status(400).json({ error: "Maximum 5 images allowed per upload" });
    }

    // Process all files
    const uploadResults = [];
    const errors = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      try {
        const key = `uploads/${userId}/${Date.now()}_${i}_${file.name}`;

        // Upload to S3
        await s3.send(
          new PutObjectCommand({
            Bucket: bucketName,
            Key: key,
            Body: file.data,
            ContentType: file.mimetype,
          })
        );

        const fileUrl = `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;

        // Record upload in database
        const uploadRecord = await createUpload(
          userId,
          fileUrl,
          file.name,
          key,
          file.size,
          file.mimetype
        );

        const uploadId = uploadRecord.upload_id;

        // Send SQS message to trigger OCR processing
        try {
          await sqsClient.send(new SendMessageCommand({
            QueueUrl: process.env.SQS_QUEUE_URL,
            MessageBody: JSON.stringify({
              uploadId,
              s3Key: key,
              userId
            })
          }));
          console.log(`Sent SQS message for upload ${uploadId}`);
        } catch (sqsError) {
          console.error('Failed to send SQS message:', sqsError);
          // Don't fail the upload if SQS fails - user can retry later
        }

        uploadResults.push({
          fileName: file.name,
          fileUrl: fileUrl,
          uploadId: uploadId,
          size: file.size,
        });
      } catch (fileErr) {
        console.error(`Error uploading file ${file.name}:`, fileErr);
        errors.push({
          fileName: file.name,
          error: fileErr.message,
        });
      }
    }

    res.status(200).json({
      message: `Successfully uploaded ${uploadResults.length} of ${files.length} images`,
      totalFiles: files.length,
      successCount: uploadResults.length,
      errorCount: errors.length,
      uploads: uploadResults,
      errors: errors.length > 0 ? errors : undefined,
      userId: userId,
    });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: "Upload failed", details: err.message });
  }
});

// --- Get user's upload history (Protected) ---
app.get("/uploads", verifyToken, async (req, res) => {
  try {
    const userId = req.user.sub;
    const limit = parseInt(req.query.limit) || 50;

    const uploads = await getUserUploads(userId, limit);

    res.status(200).json({
      message: "Upload history retrieved successfully",
      count: uploads.length,
      uploads: uploads,
    });
  } catch (err) {
    console.error("Get uploads error:", err);
    res.status(500).json({ error: "Failed to retrieve uploads", details: err.message });
  }
});

// --- Test DB connection ---
app.get("/testdb", async (req, res) => {
  try {
    const dbSecretArn = process.env.DB_SECRET_ARN || "menu-db";

    // Fetch DB secret
    const secretResponse = await sm.send(new GetSecretValueCommand({ SecretId: dbSecretArn }));
    if (!secretResponse.SecretString) throw new Error("SecretString is empty");
    const dbSecret = JSON.parse(secretResponse.SecretString);

    // First, connect to default 'postgres' database to create our database if needed
    const adminClient = new Client({
      host: dbSecret.host,
      user: dbSecret.username,
      password: dbSecret.password,
      database: "postgres", // Connect to default database
      port: dbSecret.port,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 5000,
    });

    await adminClient.connect();

    // Check if our database exists, create if not
    const dbCheckResult = await adminClient.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [dbSecret.dbname]
    );

    if (dbCheckResult.rows.length === 0) {
      console.log(`Creating database: ${dbSecret.dbname}`);
      await adminClient.query(`CREATE DATABASE "${dbSecret.dbname}"`);
    }

    await adminClient.end();

    // Now connect to our application database
    const client = new Client({
      host: dbSecret.host,
      user: dbSecret.username,
      password: dbSecret.password,
      database: dbSecret.dbname,
      port: dbSecret.port,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 5000,
    });

    await client.connect();

    // Simple query
    const result = await client.query("SELECT NOW() as current_time");
    await client.end();

    res.status(200).json({
      message: "Successfully connected to PostgreSQL!",
      time: result.rows[0].current_time,
      host: dbSecret.host,
      database: dbSecret.dbname,
    });
  } catch (err) {
    console.error("Database connection error:", err);
    res.status(500).json({ error: "Failed to connect to database", details: err.message });
  }
});

// 404 handler
app.use((req, res) => res.status(404).json({ error: "Not Found" }));

export const handler = serverless(app);


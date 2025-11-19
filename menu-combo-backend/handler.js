import serverless from "serverless-http";
import express from "express";
import cors from "cors";
import fileUpload from "express-fileupload";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import pkg from "pg";
import { verifyToken } from "./middleware/auth.js";
import { initializeDatabase, upsertUser, createUpload, getUserUploads, getPool } from "./db/index.js";
import { annotateMenuImage } from "./services/imageAnnotation.js";

const { Client } = pkg;
const app = express();
const region = "us-east-1";

// AWS Clients
const s3 = new S3Client({ region });
const sm = new SecretsManagerClient({ region });
const sqsClient = new SQSClient({ region: 'us-east-1' });

// Middleware
app.use(express.json()); // Parse JSON request bodies
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

// --- Get upload status and menu items (Protected) ---
app.get('/uploads/:uploadId', verifyToken, async (req, res) => {
  try {
    const { uploadId } = req.params;
    const userId = req.user.sub;
    const pool = await getPool();

    // Get upload info
    const uploadResult = await pool.query(
      `SELECT upload_id, file_url, file_name, ocr_status,
              items_count, ocr_error, created_at, ocr_completed_at,
              ocr_started_at
       FROM uploads
       WHERE upload_id = $1 AND user_id = $2`,
      [uploadId, userId]
    );

    if (uploadResult.rows.length === 0) {
      return res.status(404).json({ error: 'Upload not found' });
    }

    const upload = uploadResult.rows[0];

    // Transform to camelCase for frontend consistency
    const uploadFormatted = {
      uploadId: upload.upload_id,
      file_url: upload.file_url,
      file_name: upload.file_name,
      ocr_status: upload.ocr_status,
      items_count: upload.items_count,
      ocr_error: upload.ocr_error,
      created_at: upload.created_at,
      ocr_completed_at: upload.ocr_completed_at,
      ocr_started_at: upload.ocr_started_at
    };

    // If completed, get menu items
    let items = [];
    if (upload.ocr_status === 'completed') {
      const itemsResult = await pool.query(
        `SELECT item_id, item_name, price, description, category,
                bbox, confidence_score, notes, upload_id
         FROM menu_items
         WHERE upload_id = $1
         ORDER BY (bbox->>'top')::float`,
        [uploadId]
      );
      // Transform items to camelCase as well
      items = itemsResult.rows.map(item => ({
        item_id: item.item_id,
        item_name: item.item_name,
        price: item.price,
        description: item.description,
        category: item.category,
        bbox: item.bbox,
        confidence_score: item.confidence_score,
        notes: item.notes,
        upload_id: item.upload_id
      }));
    }

    res.json({
      upload: uploadFormatted,
      items
    });
  } catch (error) {
    console.error('Error fetching upload status:', error);
    res.status(500).json({ error: 'Failed to fetch upload status' });
  }
});

// --- Delete upload (Protected) ---
app.delete('/uploads/:uploadId', verifyToken, async (req, res) => {
  try {
    const { uploadId } = req.params;
    const userId = req.user.sub;

    const { deleteUpload } = await import('./db/index.js');
    const deleted = await deleteUpload(uploadId, userId);

    if (!deleted) {
      return res.status(404).json({ error: 'Upload not found or unauthorized' });
    }

    res.json({ success: true, message: 'Upload deleted successfully' });
  } catch (error) {
    console.error('Error deleting upload:', error);
    res.status(500).json({ error: 'Failed to delete upload', details: error.message });
  }
});

// --- Annotate menu image with bounding boxes (Protected) ---
app.post('/uploads/:uploadId/annotate', verifyToken, async (req, res) => {
  try {
    const { uploadId } = req.params;
    const { item_ids } = req.body;
    const userId = req.user.sub;

    if (!item_ids || !Array.isArray(item_ids)) {
      return res.status(400).json({ error: 'item_ids array is required' });
    }

    const pool = await getPool();

    // Get upload info and verify ownership
    const uploadResult = await pool.query(
      'SELECT s3_key FROM uploads WHERE upload_id = $1 AND user_id = $2',
      [uploadId, userId]
    );

    if (uploadResult.rows.length === 0) {
      return res.status(404).json({ error: 'Upload not found' });
    }

    const { s3_key } = uploadResult.rows[0];

    // Get menu items with bounding boxes
    const itemsResult = await pool.query(
      `SELECT item_id, item_name, bbox
       FROM menu_items
       WHERE item_id = ANY($1) AND upload_id = $2`,
      [item_ids, uploadId]
    );

    const items = itemsResult.rows;

    if (items.length === 0) {
      return res.status(404).json({ error: 'No items found' });
    }

    console.log(`Annotating ${items.length} items on upload ${uploadId}`);

    // Annotate image
    const annotatedImageDataUrl = await annotateMenuImage(s3_key, items);

    res.json({
      annotatedImage: annotatedImageDataUrl,
      itemCount: items.length
    });

  } catch (error) {
    console.error('Image annotation error:', error);
    res.status(500).json({ error: 'Failed to annotate image', details: error.message });
  }
});

// --- Get user preferences (Protected) ---
// Updated schema: budget_min, budget_max, people_count
app.get('/preferences', verifyToken, async (req, res) => {
  try {
    const userId = req.user.sub;
    const pool = await getPool();

    const result = await pool.query(
      `SELECT dietary_restrictions, budget_min, budget_max,
              people_count, spice_level
       FROM user_preferences
       WHERE user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      // Return default preferences if none exist
      return res.json({
        preferences: {
          people: 1,
          budget: { min: 0, max: 100 },
          dietaryRestrictions: [],
          spicyLevel: 'any'
        }
      });
    }

    const row = result.rows[0];
    res.json({
      preferences: {
        people: row.people_count || 1,
        budget: {
          min: parseFloat(row.budget_min) || 0,
          max: parseFloat(row.budget_max) || 100
        },
        dietaryRestrictions: row.dietary_restrictions || [],
        spicyLevel: row.spice_level || 'any'
      }
    });

  } catch (error) {
    console.error('Error fetching preferences:', error);
    res.status(500).json({ error: 'Failed to fetch preferences' });
  }
});

// --- Save user preferences (Protected) ---
app.put('/preferences', verifyToken, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { people, budget, dietaryRestrictions, spicyLevel } = req.body;
    const pool = await getPool();

    console.log('Saving preferences for user:', userId, req.body);

    // Upsert preferences
    const result = await pool.query(
      `INSERT INTO user_preferences
        (user_id, dietary_restrictions, budget_min, budget_max, people_count, spice_level)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id)
       DO UPDATE SET
         dietary_restrictions = $2,
         budget_min = $3,
         budget_max = $4,
         people_count = $5,
         spice_level = $6,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        userId,
        JSON.stringify(dietaryRestrictions || []),
        budget?.min || 0,
        budget?.max || 100,
        people || 1,
        spicyLevel || 'any'
      ]
    );

    console.log('Preferences saved successfully');

    res.json({
      success: true,
      preferences: {
        people: result.rows[0].people_count,
        budget: {
          min: parseFloat(result.rows[0].budget_min),
          max: parseFloat(result.rows[0].budget_max)
        },
        dietaryRestrictions: result.rows[0].dietary_restrictions,
        spicyLevel: result.rows[0].spice_level
      }
    });

  } catch (error) {
    console.error('Error saving preferences:', error);
    res.status(500).json({ error: 'Failed to save preferences' });
  }
});

// --- AI Recommendations (Protected) ---
app.post('/recommend', verifyToken, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { uploadIds, preferences } = req.body;

    if (!uploadIds || !Array.isArray(uploadIds) || uploadIds.length === 0) {
      return res.status(400).json({ error: 'uploadIds array is required' });
    }

    const pool = await getPool();

    // Fetch all menu items from the specified uploads
    const itemsResult = await pool.query(
      `SELECT mi.* FROM menu_items mi
       JOIN uploads u ON mi.upload_id = u.upload_id
       WHERE u.upload_id = ANY($1) AND u.user_id = $2
       ORDER BY mi.item_name`,
      [uploadIds, userId]
    );

    const menuItems = itemsResult.rows;

    if (menuItems.length === 0) {
      return res.status(404).json({ error: 'No menu items found for the specified uploads' });
    }

    console.log(`Generating recommendations for ${menuItems.length} menu items with preferences:`, preferences);

    // Call OpenAI to generate recommendations
    const { generateRecommendations } = await import('./services/recommendations.js');
    const recommendations = await generateRecommendations(menuItems, preferences);

    // Save recommendation to database
    const { saveRecommendation } = await import('./db/index.js');
    const recommendationId = await saveRecommendation(userId, uploadIds, recommendations, preferences);

    console.log(`Saved recommendation ${recommendationId} to database`);

    res.json({
      recommendationId,
      recommendations,
      totalItems: menuItems.length
    });
  } catch (error) {
    console.error('Error generating recommendations:', error);
    res.status(500).json({ error: 'Failed to generate recommendations', details: error.message });
  }
});

// --- Get recommendation history (Protected) ---
app.get('/recommendations', verifyToken, async (req, res) => {
  try {
    const userId = req.user.sub;
    const limit = parseInt(req.query.limit) || 50;

    const { getUserRecommendations } = await import('./db/index.js');
    const recommendations = await getUserRecommendations(userId, limit);

    res.json({
      recommendations,
      count: recommendations.length
    });
  } catch (error) {
    console.error('Error fetching recommendations:', error);
    res.status(500).json({ error: 'Failed to fetch recommendations', details: error.message });
  }
});

// --- Get single recommendation by ID (Protected) ---
app.get('/recommendations/:recommendationId', verifyToken, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { recommendationId } = req.params;

    const { getRecommendationById } = await import('./db/index.js');
    const recommendation = await getRecommendationById(recommendationId, userId);

    if (!recommendation) {
      return res.status(404).json({ error: 'Recommendation not found' });
    }

    res.json(recommendation);
  } catch (error) {
    console.error('Error fetching recommendation:', error);
    res.status(500).json({ error: 'Failed to fetch recommendation', details: error.message });
  }
});

// 404 handler
app.use((req, res) => res.status(404).json({ error: "Not Found" }));

export const handler = serverless(app);


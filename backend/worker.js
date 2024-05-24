// backend/worker.js
const { Worker, Queue } = require('bullmq');
const { processPDF } = require('./pdfProcessor');
const IORedis = require('ioredis');
const { Pool } = require('pg');

const redisConnection = new IORedis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  maxRetriesPerRequest: null,
});

const pool = new Pool({
  user: process.env.POSTGRES_USER || 'root',
  host: process.env.POSTGRES_HOST || 'localhost',
  database: process.env.POSTGRES_DB || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'root',
  port: process.env.POSTGRES_PORT || 5432,
});

const worker = new Worker('pdfQueue', async (job) => {
  console.log("worker started ")
  const { projectId, filePathOrUrl } = job.data;
  try {
    const embeddings = await processPDF(filePathOrUrl);
    const embeddingJson=JSON.stringify(embeddings)
    console.log(embeddingJson)
    await pool.query('UPDATE projects SET embeddings = $1, status = $2 WHERE id = $3', [embeddingJson, 'created', projectId]);
  } catch (error) {
    await pool.query('UPDATE projects SET status = $1 WHERE id = $2', ['failed', projectId]);
    console.error('Error processing PDF:', error);
  }
}, { connection: redisConnection });

worker.on('error', (error) => {
  console.error('Worker error:', error);
});

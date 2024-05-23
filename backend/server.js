// backend/server.js
const express = require('express');
const multer = require('multer');
const { Pool } = require('pg');
const { Queue, Worker } = require('bullmq');
const { processPDF } = require('./pdfProcessor');

const app = express();
const upload = multer({ dest: 'uploads/' });
const pool = new Pool({
  user: 'your_postgres_user',
  host: 'localhost',
  database: 'your_database',
  password: 'your_password',
  port: 5432,
});

const pdfQueue = new Queue('pdf-processing');

app.use(express.json());

app.post('/projects', upload.single('file'), async (req, res) => {
  const { title, description } = req.body;
  const file = req.file;

  try {
    const result = await pool.query(
      'INSERT INTO projects (title, description, file_path, status) VALUES ($1, $2, $3, $4) RETURNING *',
      [title, description, file.path, 'creating']
    );
    const project = result.rows[0];

    await pdfQueue.add('processPDF', { projectId: project.id, filePath: file.path });

    res.status(201).json(project);
  } catch (error) {
    console.error('Error creating project:', error);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

app.get('/projects', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM projects');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching projects:', error);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

app.post('/projects/:id/chat', async (req, res) => {
  const { id } = req.params;
  const { query } = req.body;

  try {
    const result = await pool.query('SELECT embeddings FROM projects WHERE id = $1', [id]);
    const embeddings = result.rows[0].embeddings;

    // Use your LLM API to get a response based on the query and embeddings
    const response = await getChatResponse(query, embeddings);
    res.json({ response });
  } catch (error) {
    console.error('Error fetching chat response:', error);
    res.status(500).json({ error: 'Failed to fetch chat response' });
  }
});

const getChatResponse = async (query, embeddings) => {
  // Integrate with your LLM API
  // This is a placeholder function
  return "This is a placeholder response based on the query and embeddings.";
};

app.listen(5000, () => {
  console.log('Server is running on port 5000');
});

// Worker to process PDF files
const worker = new Worker('pdf-processing', async job => {
  const { projectId, filePath } = job.data;
  try {
    const embeddings = await processPDF(filePath);
    await pool.query('UPDATE projects SET embeddings = $1, status = $2 WHERE id = $3', [embeddings, 'created', projectId]);
  } catch (error) {
    await pool.query('UPDATE projects SET status = $1 WHERE id = $2', ['failed', projectId]);
    console.error('Error processing PDF:', error);
  }
});

const express = require('express');
const multer = require('multer');
const { Pool } = require('pg');
const { processPDF } = require('./pdfProcessor');
require('dotenv').config();

const app = express();
const upload = multer({ dest: 'uploads/' });
const pool = new Pool({
  user: process.env.POSTGRES_USER,
  host: process.env.POSTGRES_HOST,
  database: process.env.POSTGRES_DB,
  password: process.env.POSTGRES_PASSWORD,
  port: process.env.POSTGRES_PORT,
});

app.use(express.json());

app.post('/projects', upload.single('file'), async (req, res) => {
  const { title, description } = req.body;
  const file = req.file;

  try {
    // Insert project with 'processing' status
    const result = await pool.query(
      'INSERT INTO projects (title, description, file_path, status) VALUES ($1, $2, $3, $4) RETURNING *',
      [title, description, file.path, 'processing']
    );
    const project = result.rows[0];

    // Process PDF and generate embeddings
    const embeddings = await processPDF(file.path);

    // Update project with embeddings and 'created' status
    await pool.query('UPDATE projects SET embeddings = $1::jsonb, status = $2 WHERE id = $3', [JSON.stringify(embeddings), 'created', project.id]);

    // Return the updated project
    const updatedProject = await pool.query('SELECT * FROM projects WHERE id = $1', [project.id]);
    res.status(201).json(updatedProject.rows[0]);
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

const express = require('express');
const multer = require('multer');
const { Pool } = require('pg');
const { processPDF } = require('./pdfProcessor');
const { default: axios } = require('axios');
require('dotenv').config();
const bodyParser = require('body-parser');
const fs = require('fs');
const AWS = require('aws-sdk');

// AWS configuration
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

const s3 = new AWS.S3();

const app = express();
const upload = multer({ dest: 'uploads/' });

const pool = new Pool({
  user: process.env.POSTGRES_USER,
  host: process.env.POSTGRES_HOST,
  database: process.env.POSTGRES_DB,
  password: process.env.POSTGRES_PASSWORD,
  port: process.env.POSTGRES_PORT,
});

app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

app.use(express.json());

// Log environment variables
console.log('AWS_ACCESS_KEY_ID:', process.env.AWS_ACCESS_KEY_ID);
console.log('AWS_SECRET_ACCESS_KEY:', process.env.AWS_SECRET_ACCESS_KEY);
console.log('AWS_REGION:', process.env.AWS_REGION);
console.log('S3_BUCKET_NAME:', process.env.S3_BUCKET_NAME);

app.post('/projects', upload.single('file'), async (req, res) => {
  const { title, description } = req.body;
  const file = req.file;

  console.log('Request Body:', req.body);
  console.log('Uploaded File:', file);

  if (!file) {
    return res.status(400).json({ error: 'File is required' });
  }

  const uploadParams = {
    Bucket: process.env.S3_BUCKET_NAME,
    Key: `${Date.now()}_${file.originalname}`, // Unique file name
    Body: fs.createReadStream(file.path),
    ContentType: file.mimetype,
  };

  try {
    const s3Result = await s3.upload(uploadParams).promise();
    console.log('File uploaded successfully to S3', s3Result.Location);

    const result = await pool.query(
      'INSERT INTO projects (title, description, file_path, status) VALUES ($1, $2, $3, $4) RETURNING *',
      [title, description, s3Result.Location, 'processing']
    );
    const project = result.rows[0];

    const embeddings = await processPDF(s3Result.Location);

    await pool.query('UPDATE projects SET embeddings = $1::jsonb, status = $2 WHERE id = $3', [JSON.stringify(embeddings), 'created', project.id]);

    const updatedProject = await pool.query('SELECT * FROM projects WHERE id = $1', [project.id]);
    res.status(201).json(updatedProject.rows[0]);
  } catch (error) {
    console.error('Error creating project:', error);
    res.status(500).json({ error: 'Failed to create project' });
  } finally {
    fs.unlinkSync(file.path);
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

    const response = await getChatResponse(query, embeddings);
    res.json({ response });
  } catch (error) {
    console.error('Error fetching chat response:', error);
    res.status(500).json({ error: 'Failed to fetch chat response' });
  }
});

const getChatResponse = async (query, embeddings) => {
  try {
    const prompt = `Use the following embeddings to answer the question:\n\nEmbeddings: ${JSON.stringify(embeddings)}\n\nQuestion: ${query}\n\nAnswer:`;

    const response = await axios.post(
      'https://api.openai.com/v1/completions',
      {
        model: 'text-davinci-003',
        prompt: prompt,
        max_tokens: 100,
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPEN_AI}`,
          'Content-Type': 'application/json',
        }
      }
    );
    return response.data.choices[0].text.trim();
  } catch (error) {
    console.error('Error generating chat response:', error);
    return 'Error generating response';
  }
};

app.listen(5000, () => {
  console.log('Server is running on port 5000');
});

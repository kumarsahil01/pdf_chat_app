const express = require('express');
const multer = require('multer');
const { Pool } = require('pg');
const { default: axios } = require('axios');
const AWS = require('aws-sdk');
const { Queue } = require('bullmq');
const fs = require('fs');
require('dotenv').config();
const bodyParser = require('body-parser');

const app = express();
const upload = multer({ dest: 'uploads/' });

AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

const s3 = new AWS.S3();

const pdfQueue = new Queue('pdfQueue', {
  connection: {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT
  }
});

const pool = new Pool({
  user: process.env.POSTGRES_USER,
  host: process.env.POSTGRES_HOST,
  database: process.env.POSTGRES_DB,
  password: process.env.POSTGRES_PASSWORD,
  port: process.env.POSTGRES_PORT
});

app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

app.post('/projects', upload.single('file'), async (req, res) => {
  const { title, description } = req.body;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: 'File is required' });
  }

  const uploadParams = {
    Bucket: process.env.S3_BUCKET_NAME,
    Key: `${Date.now()}_${file.originalname}`,
    Body: fs.createReadStream(file.path),
    ContentType: file.mimetype
  };

  try {
    const s3Result = await s3.upload(uploadParams).promise();
    const result = await pool.query(
      'INSERT INTO projects (title, description, file_path, status) VALUES ($1, $2, $3, $4) RETURNING *',
      [title, description, s3Result.Location, 'processing']
    );
    const project = result.rows[0];
    console.log(project.file_path)

   const job= await pdfQueue.add('processPDF', { filePathOrUrl: project.file_path, projectId: project.id },{ removeOnComplete: 1000, removeOnFail: 5000 });

   console.log(job)
   
    res.status(201).json(project);
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
    const prompt = `Please summarize the ${query} and use the following embeddings to answer the question:\n\nEmbeddings: ${JSON.stringify(embeddings)}\n\nQuestion: ${query}\n\nAnswer:`;

    const response = await axios.post(
      'https://api.openai.com/v1/completions',
      {
        model: 'text-davinci-003',
        prompt: prompt
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPEN_AI}`,
          'Content-Type': 'application/json'
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

const express = require('express');
const multer = require('multer');
const { Pool } = require('pg');
const { default: axios } = require('axios');
const AWS = require('aws-sdk');
const { Queue } = require('bullmq');
const fs = require('fs');
const cors =require('cors')
require('dotenv').config();
const bodyParser = require('body-parser');

const app = express();
const upload = multer({ dest: 'uploads/' });
app.use(cors())

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


   const job= await pdfQueue.add('processPDF', { filePathOrUrl: project.file_path, projectId: project.id },{ removeOnComplete: 1000, removeOnFail: 5000 });


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


const getQueryEmbedding = async (query) => {
  const response = await axios.post(
    'https://api.openai.com/v1/embeddings',
    {
      model: 'text-embedding-ada-002',
      input: query,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPEN_AI}`,
      },
    }
  );
  return response.data.data[0].embedding;
};



// Function to calculate cosine similarity
function cosineSimilarity(vec1, vec2) {
  console.log('vec1:', vec1);
  console.log('vec2:', vec2);

  if (!Array.isArray(vec1) || !Array.isArray(vec2)) {
    throw new Error('Vectors must be arrays');
  }

  const dotProduct = vec1.reduce((acc, v, i) => acc + v * vec2[i], 0);
  const magnitudeA = Math.sqrt(vec1.reduce((acc, v) => acc + v * v, 0));
  const magnitudeB = Math.sqrt(vec2.reduce((acc, v) => acc + v * v, 0));

  return dotProduct / (magnitudeA * magnitudeB);
}


app.post('/projects/:id/chat', async (req, res) => {
  const { id } = req.params;
  const { query } = req.body;

  try {
    const queryEmbedding = await getQueryEmbedding(query);

    const result = await pool.query('SELECT embeddings FROM projects WHERE id = $1', [id]);
    const embeddings = result.rows[0].embeddings;
    console.log(embeddings)
    if (!Array.isArray(embeddings)) {
      throw new Error('Embeddings must be an array');
    }
    const context = embeddings.join(' ');

    const prompt = `Use the following context to answer the question:\n\nContext: ${context}\n\nQuestion: ${query}\n\nAnswer:`;

    const response = await axios.post(
      'https://api.openai.com/v1/completions',
      {
        model: 'gpt-3.5-turbo-instruct',
        prompt: prompt,
        max_tokens: 1000, // Adjust this based on your needs
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPEN_AI}`,
          'Content-Type': 'application/json',
        },
      }
    );

    res.json({ response: response.data.choices[0].text.trim() });
  } catch (error) {
    console.error('Error fetching chat response:', error.response ? error.response.data : error.message);
    res.status(500).json({ error: 'Failed to fetch chat response' });
  }
});




app.listen(5000, () => {
  console.log('Server is running on port 5000');
});

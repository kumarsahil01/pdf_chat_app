const fs = require('fs');
const pdfParse = require('pdf-parse');
const axios = require('axios');
require('dotenv').config();

const processPDF = async (filePath) => {
  const dataBuffer = fs.readFileSync(filePath);
  const pdfData = await pdfParse(dataBuffer);
  const text = pdfData.text;

  // Call OpenAI API to generate embeddings
  const response = await axios.post(
    'https://api.openai.com/v1/embeddings',
    {
      input: text,
      model: 'text-embedding-ada-002'  // Use the appropriate model
    },
    {
      headers: {
        'Authorization': `Bearer ${process.env.OPEN_AI}`,
        'Content-Type': 'application/json'
      }
    }
  );

  return response.data.data[0].embedding;
};

module.exports = { processPDF };

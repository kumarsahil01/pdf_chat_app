// backend/pdfProcessor.js
const fs = require('fs');
const pdfParse = require('pdf-parse');
const axios = require('axios');

const processPDF = async (filePath) => {
  const dataBuffer = fs.readFileSync(filePath);
  const pdfData = await pdfParse(dataBuffer);
  const text = pdfData.text;

  // Call an external service to generate embeddings
  const response = await axios.post('http://your-embedding-service', { text });
  return response.data.embeddings;
};

module.exports = { processPDF };

const fs = require('fs');
const pdfParse = require('pdf-parse');
const axios = require('axios');
const { Readable } = require('stream');
require('dotenv').config();

const processPDF = async (filePathOrUrl) => {
  let dataBuffer;

  if (filePathOrUrl.startsWith('http')) {
    const response = await axios.get(filePathOrUrl, { responseType: 'arraybuffer' });
    dataBuffer = Buffer.from(response.data);
  } else {
    dataBuffer = fs.readFileSync(filePathOrUrl);
  }

  const pdfData = await pdfParse(dataBuffer);
  const text = pdfData.text;

  const response = await axios.post(
    'https://api.openai.com/v1/embeddings',
    {
      input: text,
      model: 'text-embedding-ada-002'
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

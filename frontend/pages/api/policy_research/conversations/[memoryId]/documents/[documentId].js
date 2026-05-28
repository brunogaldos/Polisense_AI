// API proxy for single document operations - with body parsing enabled
import axios from 'axios';

export default async function handler(req, res) {
  const { method, body, query } = req;
  const { memoryId, documentId } = query;

  const baseUrl = process.env.RESEARCH_API_URL || 'http://localhost:5029';
  const targetUrl = `${baseUrl}/api/policy_research/conversations/${memoryId}/documents/${documentId}`;

  console.log(`📄 Document API: ${method} ${targetUrl}`);
  console.log(`📄 Body:`, JSON.stringify(body, null, 2));

  // Handle OPTIONS request for CORS
  if (method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).end();
  }

  try {
    // For DELETE requests, userId might be in query params
    const requestUrl = method === 'DELETE' && query.userId
      ? `${targetUrl}?userId=${query.userId}`
      : targetUrl;

    const response = await axios({
      method,
      url: requestUrl,
      data: body,
      headers: {
        'Content-Type': 'application/json',
        ...(req.headers.authorization && { 'Authorization': req.headers.authorization }),
      },
      timeout: 30000, // 30 second timeout
    });

    console.log(`📄 Document API response:`, response.status);

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    res.status(response.status).json(response.data);
  } catch (error) {
    console.error('📄 Document API error:', error.message);

    if (error.response) {
      console.error('Backend error:', error.response.status, error.response.data);
      res.status(error.response.status).json(error.response.data);
    } else if (error.code === 'ECONNREFUSED') {
      res.status(503).json({ error: 'Backend server is not available' });
    } else {
      res.status(500).json({ error: 'Request failed', message: error.message });
    }
  }
}

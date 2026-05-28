// API proxy for policy research backend - main endpoint
import axios from 'axios';

export default async function handler(req, res) {
  const { method, body, query } = req;
  
  // Backend base URL:
  // - In local development, the backend usually runs on http://localhost:5029
  // - When running the frontend in Docker, you should override this with the
  //   RESEARCH_API_URL env var so the container can reach the backend host/service.
  const baseUrl = process.env.RESEARCH_API_URL || 'http://localhost:5029';
  const targetUrl = `${baseUrl}/api/policy_research/`;
  
  console.log(`🔄 Proxying ${method} request to: ${targetUrl}`);
  console.log(`📋 Body:`, body);
  
  try {
    // Forward the request to the backend
    const response = await axios({
      method,
      url: targetUrl,
      data: body,
      params: query,
      headers: {
        'Content-Type': req.headers['content-type'] || 'application/json',
        // Forward authorization header if present
        ...(req.headers.authorization && { 'Authorization': req.headers.authorization }),
      },
      timeout: 40000, // 40 second timeout
    });

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Return the response
    res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Policy research proxy error:', error.message);
    console.error('Error stack:', error.stack);
    
    if (error.response) {
      // Forward the error response from the API
      console.error('Backend response error:', error.response.status, error.response.data);
      res.status(error.response.status).json(error.response.data);
    } else if (error.code === 'ECONNREFUSED') {
      // Backend server is not running
      console.error('Backend server connection refused');
      res.status(503).json({ error: 'Backend server is not available', message: 'Please ensure the backend server is running on port 5029' });
    } else {
      // Network or other error
      console.error('Network error:', error.code, error.message);
      res.status(500).json({ error: 'Policy research proxy request failed', message: error.message });
    }
  }
}


























































































































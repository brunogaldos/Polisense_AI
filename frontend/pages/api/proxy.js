// API proxy to handle CORS issues with WRI API
import axios from 'axios';

export default async function handler(req, res) {
  const { method, body, query } = req;
  const { path, ...queryParams } = query;
  
  // Construct the target URL
  const targetPath = Array.isArray(path) ? path.join('/') : path || '';
  const baseUrl = process.env.NEXT_PUBLIC_WRI_API_URL || 'https://api.resourcewatch.org';
  const targetUrl = `${baseUrl}/v1/${targetPath}`;
  
  try {
    // Forward the request to the WRI API
    const response = await axios({
      method,
      url: targetUrl,
      data: body,
      params: queryParams,
      headers: {
        'Content-Type': req.headers['content-type'] || 'application/json',
        // Forward authorization header if present
        ...(req.headers.authorization && { 'Authorization': req.headers.authorization }),
      },
    });

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Return the response
    res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Proxy error:', error.message);
    
    if (error.response) {
      // Forward the error response from the API
      res.status(error.response.status).json(error.response.data);
    } else {
      // Network or other error
      res.status(500).json({ error: 'Proxy request failed', message: error.message });
    }
  }
}
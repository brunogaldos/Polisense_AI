// Catch-all API proxy to handle CORS issues with WRI API
import axios from 'axios';

export default async function handler(req, res) {
  const { method, body, query } = req;
  const { path, ...queryParams } = query;
  
  // Handle OPTIONS request for CORS preflight
  if (method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).end();
  }
  
  // Construct the target URL
  const targetPath = Array.isArray(path) ? path.join('/') : path || '';
  const baseUrl = process.env.NEXT_PUBLIC_WRI_API_URL || 'https://api.resourcewatch.org';
  const targetUrl = `${baseUrl}/v1/${targetPath}`;
  
  // Log the request for debugging
  console.log(`[PROXY] ${method} ${targetUrl}`);
  console.log('[PROXY] Query params:', queryParams);
  console.log('[PROXY] Body:', body);
  
  try {
    // Prepare headers
    const headers = {
      'User-Agent': 'ResourceWatch/3.2.1',
      // Forward authorization header if present
      ...(req.headers.authorization && { 'Authorization': req.headers.authorization }),
    };
    
    // Only set content-type for requests with body
    if (body && Object.keys(body).length > 0) {
      headers['Content-Type'] = req.headers['content-type'] || 'application/json';
    }
    
    // Forward the request to the WRI API
    const response = await axios({
      method,
      url: targetUrl,
      ...(body && Object.keys(body).length > 0 && { data: body }),
      params: queryParams,
      headers,
      timeout: 40000, // 40 second timeout
      validateStatus: function (status) {
        // Don't throw for any status code, let the client handle it
        return true;
      }
    });

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    console.log(`[PROXY] Response status: ${response.status}`);
    
    // Return the response
    res.status(response.status).json(response.data);
  } catch (error) {
    console.error('[PROXY] Error:', error.message);
    console.error('[PROXY] Target URL:', targetUrl);
    
    // Set CORS headers even for error responses
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (error.response) {
      console.error('[PROXY] API Error Response:', error.response.status, error.response.data);
      // Forward the error response from the API
      res.status(error.response.status).json(error.response.data);
    } else {
      // Network or other error
      res.status(500).json({ 
        error: 'Proxy request failed', 
        message: error.message,
        targetUrl: targetUrl 
      });
    }
  }
}
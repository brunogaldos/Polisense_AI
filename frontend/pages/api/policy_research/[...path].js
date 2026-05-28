// API proxy for policy research backend - catch-all route
import axios from 'axios';
import http from 'http';
import https from 'https';
import { URL } from 'url';
import getRawBody from 'raw-body';

// Disable body parsing to handle file uploads
export const config = {
  api: {
    bodyParser: false,
    // Increase timeout to 10 minutes for long-running MinerU extractions
    responseLimit: false,
    externalResolver: true,
  },
  // Next.js 13+ maxDuration (in seconds) - 10 minutes
  maxDuration: 600,
};

export default async function handler(req, res) {
  const { method, query } = req;
  const { path } = query;
  
  // Construct the target URL
  const targetPath = Array.isArray(path) ? path.join('/') : path || '';
  // Backend base URL:
  // - In local development, the backend usually runs on http://localhost:5029
  // - When running the frontend in Docker, you should override this with the
  //   RESEARCH_API_URL env var so the container can reach the backend host/service.
  const baseUrl = process.env.RESEARCH_API_URL || 'http://localhost:5029';
  const targetUrl = `${baseUrl}/api/policy_research/${targetPath}`;
  
  console.log(`🔄 Proxying ${method} request to: ${targetUrl}`);
  console.log(`📋 Path: ${targetPath}, Query:`, query);
  
  // Handle OPTIONS request for CORS
  if (method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).end();
  }
  
  try {
    const contentType = req.headers['content-type'] || '';
    const isFileUpload = contentType.includes('multipart/form-data');
    
    // For file uploads, use native http/https module to stream the request
    if (isFileUpload && method !== 'GET' && method !== 'DELETE') {
      return new Promise((resolve, reject) => {
        const url = new URL(targetUrl);
        const isHttps = url.protocol === 'https:';
        const httpModule = isHttps ? https : http;
        
        let responseSent = false;
        let timeoutId = null;
        let proxyReq = null;
        
        // Prepare headers, handling Expect: 100-continue properly
        const headers = {
          ...req.headers,
          host: url.host,
        };
        
        // Ensure connection stays alive during upload
        headers['Connection'] = 'keep-alive';
        headers['Keep-Alive'] = 'timeout=600';
        
        // If client sent Expect: 100-continue, forward it to backend
        // Backend will respond with 100 Continue to keep connection alive
        if (req.headers.expect === '100-continue') {
          headers['Expect'] = '100-continue';
        }
        
        const options = {
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: url.pathname + (url.search || ''),
          method: method,
          headers: headers,
          timeout: 600000, // 10 minutes
        };
        
        // Set timeout for the entire request (10 minutes to match backend)
        timeoutId = setTimeout(() => {
          if (!responseSent && proxyReq) {
            responseSent = true;
            proxyReq.destroy();
            if (!res.headersSent && !res.destroyed) {
              try {
                res.status(504).json({ 
                  error: 'Request timeout', 
                  message: 'The request took too long to complete. Please try again with a smaller file.' 
                });
              } catch (err) {
                console.error('Error sending timeout response:', err);
              }
            }
            reject(new Error('Request timeout'));
          }
        }, 600000); // 10 minutes
        
        // Handle client disconnect - don't destroy the backend request, just mark that we won't send response
        req.on('close', () => {
          if (!responseSent) {
            console.warn('⚠️ Client disconnected before response - backend will continue processing');
            // Don't destroy proxyReq - let backend finish processing
            // The backend will still process the file and save results with fileId
            // Frontend can retrieve results later using the file name
            responseSent = true;
            // Clear timeout since client is gone
            if (timeoutId) clearTimeout(timeoutId);
            // Don't destroy proxyReq - let it complete
          }
        });
        
        // Also handle abort (browser navigation, etc.)
        req.on('aborted', () => {
          if (!responseSent) {
            console.warn('⚠️ Request aborted - backend will continue processing');
            responseSent = true;
            if (timeoutId) clearTimeout(timeoutId);
            // Don't destroy proxyReq - let it complete
          }
        });
        
        // CRITICAL: The issue is that multer buffers the entire file before the handler runs
        // During this time, no response is sent, causing client to disconnect
        // We need to ensure the connection stays alive during this buffering phase
        
        // Start piping immediately to backend - don't wait
        // The backend will send 100 Continue if it receives Expect header
        // But since axios doesn't send it, we rely on keep-alive headers
        
        proxyReq = httpModule.request(options, (proxyRes) => {
          // Clear timeout on response
          if (timeoutId) clearTimeout(timeoutId);
          
          // Handle 100 Continue response (early acknowledgment from backend)
          // This keeps the connection alive during multer's file buffering phase
          if (proxyRes.statusCode === 100) {
            // Forward 100 Continue to client to keep connection alive during upload
            if (!responseSent && !res.headersSent && !res.destroyed) {
              try {
                res.writeContinue && res.writeContinue();
                console.log('✅ Forwarded 100 Continue to client (keeping connection alive)');
              } catch (err) {
                // Ignore if not supported
              }
            }
            // Continue waiting for the actual response (202 or 200)
            return;
          }
          
          // If client disconnected, just consume the stream and don't send response
          if (responseSent || res.destroyed) {
            console.log('⚠️ Client disconnected, consuming backend response without sending to client');
            proxyRes.on('data', () => {}); // Consume data
            proxyRes.on('end', () => {
              console.log(`✅ Backend finished processing (client disconnected):`, proxyRes.statusCode);
              resolve();
            });
            return;
          }
          
          // Set CORS headers only if client is still connected
          if (!res.headersSent && !res.destroyed) {
            try {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
          
              // Copy response headers (excluding hop-by-hop headers)
              const responseHeaders = { ...proxyRes.headers };
              delete responseHeaders['connection'];
              delete responseHeaders['transfer-encoding'];
              delete responseHeaders['upgrade'];
              
              res.writeHead(proxyRes.statusCode, responseHeaders);
            } catch (err) {
              console.error('Error writing headers:', err);
              // Client disconnected while writing headers - consume stream
              proxyRes.on('data', () => {});
              proxyRes.on('end', () => resolve());
              return;
            }
          }
          
          // Handle response stream errors
          proxyRes.on('error', (error) => {
            // Suppress error if client already disconnected (expected behavior)
            if (responseSent || res.destroyed) {
              // Client disconnected - this error is expected, just resolve silently
              resolve();
              return;
            }
            
            // Only log and handle error if client is still connected
            console.error('Proxy response stream error:', error);
            if (!responseSent && !res.headersSent && !res.destroyed) {
              try {
                responseSent = true;
                res.status(500).json({ 
                  error: 'Response stream error', 
                  message: error.message 
                });
              } catch (err) {
                console.error('Error sending error response:', err);
              }
            }
            reject(error);
          });
          
          // Pipe response to client (we already checked if client is connected above)
          // Handle pipe errors gracefully (client disconnect during response)
          proxyRes.pipe(res, { end: false }).on('error', (pipeError) => {
            // EPIPE and ECONNRESET are expected when client disconnects
            if (pipeError.code === 'EPIPE' || pipeError.code === 'ECONNRESET') {
              // Client disconnected - consume the rest of the response
              proxyRes.on('data', () => {});
              proxyRes.on('end', () => {
                console.log(`✅ Backend finished processing (client disconnected during response):`, proxyRes.statusCode);
                resolve();
              });
            } else {
              console.error('Pipe error:', pipeError);
              resolve(); // Resolve anyway to prevent hanging
            }
          });
          
          proxyRes.on('end', () => {
            if (!responseSent && !res.destroyed) {
              try {
                responseSent = true;
            console.log(`✅ Backend response:`, proxyRes.statusCode);
                res.end();
                resolve();
              } catch (err) {
                // EPIPE/ECONNRESET expected if client disconnected
                if (err.code === 'EPIPE' || err.code === 'ECONNRESET') {
                  console.log(`✅ Backend finished processing (client disconnected):`, proxyRes.statusCode);
                } else {
                  console.error('Error ending response:', err);
                }
                resolve(); // Resolve anyway to prevent hanging
              }
            } else {
              // Client disconnected, but backend finished - just resolve
              console.log(`✅ Backend finished processing (client disconnected):`, proxyRes.statusCode);
            resolve();
            }
          });
        });
        
        proxyReq.on('error', (error) => {
          // Suppress error logging if client already disconnected or if it's an ECONNRESET (expected behavior)
          if (responseSent || res.destroyed || error.code === 'ECONNRESET') {
            // Client disconnected - this error is expected for long-running extractions
            // Backend will continue processing, frontend can fetch result later using fileId
            if (timeoutId) clearTimeout(timeoutId);
            resolve(); // Resolve silently instead of rejecting
            return;
          }
          
          // Only log and handle error if client is still connected and it's not a disconnect error
          console.error('Proxy request error:', error);
          if (timeoutId) clearTimeout(timeoutId);
          // Only send error if client is still connected and headers not sent
          if (!responseSent && !res.headersSent && !res.destroyed) {
            try {
              responseSent = true;
              res.status(500).json({ 
                error: 'Policy research proxy request failed', 
                message: error.message 
              });
            } catch (err) {
              console.error('Error sending error response:', err);
            }
          }
          reject(error);
        });
        
        // Handle request timeout
        proxyReq.on('timeout', () => {
          console.error('Proxy request timeout');
          if (timeoutId) clearTimeout(timeoutId);
          proxyReq.destroy();
          if (!responseSent && !res.headersSent && !res.destroyed) {
            try {
              responseSent = true;
              res.status(504).json({ 
                error: 'Request timeout', 
                message: 'The request took too long to complete.' 
              });
            } catch (err) {
              console.error('Error sending timeout response:', err);
            }
          }
          reject(new Error('Request timeout'));
        });
        
        // Handle response errors
        res.on('error', (error) => {
          // Suppress error if client already disconnected (expected behavior)
          // EPIPE and ECONNRESET are expected when client disconnects
          if (responseSent || res.destroyed || error.code === 'EPIPE' || error.code === 'ECONNRESET') {
            if (timeoutId) clearTimeout(timeoutId);
            // Don't destroy proxyReq - let backend finish processing
            resolve(); // Resolve silently instead of rejecting
            return;
          }
          
          // Only log and handle error if client is still connected
          console.error('Response error:', error);
          if (timeoutId) clearTimeout(timeoutId);
          if (!responseSent) {
            responseSent = true;
            proxyReq.destroy();
          }
          reject(error);
        });
        
        // CRITICAL: Start piping immediately to keep connection alive
        // The proxyReq callback will handle the response when it arrives
        // But we need to start streaming the request body immediately
        
        // Set up request error handler
        req.on('error', (err) => {
          console.error('❌ Request stream error:', err);
          if (proxyReq && !proxyReq.destroyed) {
            proxyReq.destroy();
          }
          if (!responseSent && !res.destroyed) {
            responseSent = true;
            if (timeoutId) clearTimeout(timeoutId);
            reject(err);
          }
        });
        
        // Log when request starts
        console.log('📤 Starting to pipe request to backend...');
        
        // Pipe the request body to the proxy request
        // This immediately starts streaming the upload to the backend
        // The connection stays alive because data is flowing
        req.pipe(proxyReq);
        
        // Log when piping completes
        req.on('end', () => {
          console.log('✅ Request body fully piped to backend');
        });
      });
    }
    
    // For GET requests that return large or binary responses (extraction results,
    // document downloads), stream the response. Going through axios + res.json()
    // would JSON-stringify binary bytes and corrupt them.
    const isGetRequest = method === 'GET';
    const mightBeLargeResponse =
      isGetRequest &&
      (targetPath.includes('extract/result') || targetPath.endsWith('/download'));
    
    if (mightBeLargeResponse) {
      // Stream GET responses to avoid buffering large responses
      return new Promise((resolve, reject) => {
        const url = new URL(targetUrl);
        const isHttps = url.protocol === 'https:';
        const httpModule = isHttps ? https : http;
        
        let responseSent = false;
        let timeoutId = null;
        let responseBuffer = Buffer.alloc(0);
        
        const options = {
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: url.pathname + (url.search || ''),
          method: 'GET',
          headers: {
            ...req.headers,
            host: url.host,
            'Connection': 'keep-alive',
          },
          timeout: 600000, // 10 minutes
        };
        
        timeoutId = setTimeout(() => {
          if (!responseSent) {
            responseSent = true;
            if (!res.headersSent && !res.destroyed) {
              try {
                res.status(504).json({ 
                  error: 'Request timeout', 
                  message: 'The request took too long to complete.' 
                });
              } catch (err) {
                console.error('Error sending timeout response:', err);
              }
            }
            resolve(); // Resolve instead of reject to prevent unhandled rejection
          }
        }, 600000);
        
        req.on('close', () => {
          if (!responseSent) {
            responseSent = true;
            if (timeoutId) clearTimeout(timeoutId);
          }
        });
        
        const proxyReq = httpModule.request(options, (proxyRes) => {
          if (timeoutId) clearTimeout(timeoutId);
          
          // Set CORS headers
          if (!responseSent && !res.destroyed && !res.headersSent) {
            try {
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
              res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
              res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'application/json');
              // Forward Content-Disposition (download filename) and Content-Length
              // when present — required for correct file download behaviour.
              if (proxyRes.headers['content-disposition']) {
                res.setHeader('Content-Disposition', proxyRes.headers['content-disposition']);
              }
              if (proxyRes.headers['content-length']) {
                res.setHeader('Content-Length', proxyRes.headers['content-length']);
              }
              res.setHeader('Connection', 'keep-alive');
              
              responseSent = true;
              res.status(proxyRes.statusCode || 200);
              
              // Stream the response directly to avoid buffering
              proxyRes.on('data', (chunk) => {
                if (!res.destroyed) {
                  try {
                    res.write(chunk);
                  } catch (err) {
                    // Client disconnected, ignore
                    if (err.code !== 'EPIPE' && err.code !== 'ECONNRESET') {
                      console.error('Error writing chunk:', err);
                    }
                  }
                }
              });
              
              proxyRes.on('end', () => {
                if (!res.destroyed) {
                  try {
                    res.end();
                  } catch (err) {
                    // Ignore errors if client disconnected
                    if (err.code !== 'EPIPE' && err.code !== 'ECONNRESET') {
                      console.error('Error ending response:', err);
                    }
                  }
                }
                resolve();
              });
              
              proxyRes.on('error', (err) => {
                // Suppress errors if client disconnected
                if (err.code !== 'EPIPE' && err.code !== 'ECONNRESET') {
                  console.error('Proxy response error:', err);
                }
                if (!res.destroyed && !res.headersSent) {
                  try {
                    res.status(500).json({ error: 'Response error', message: err.message });
                  } catch (e) {
                    // Ignore
                  }
                }
                resolve(); // Resolve instead of reject
              });
            } catch (err) {
              console.error('Error setting up streaming response:', err);
              if (!res.destroyed && !res.headersSent) {
                try {
                  res.status(500).json({ error: 'Streaming error', message: err.message });
                } catch (e) {
                  // Ignore
                }
              }
              resolve(); // Resolve instead of reject
            }
          } else {
            // Client disconnected, consume response
            proxyRes.on('data', () => {});
            proxyRes.on('end', () => {
              resolve();
            });
          }
        });
        
        proxyReq.on('error', (error) => {
          if (timeoutId) clearTimeout(timeoutId);
          if (!responseSent && !res.headersSent && !res.destroyed) {
            try {
              responseSent = true;
              res.status(500).json({ 
                error: 'Proxy request failed', 
                message: error.message 
              });
            } catch (err) {
              console.error('Error sending error response:', err);
            }
          }
          resolve(); // Resolve instead of reject to prevent unhandled rejection
        });
        
        proxyReq.end();
      });
    }
    
    // For other requests, use axios (simpler for JSON)
    let requestData = undefined;
    let hasBody = false;

    console.log(`📋 Processing ${method} request to ${targetPath}`);

    if (method !== 'GET' && method !== 'DELETE') {
      // The custom Express server (server/app.js) runs bodyParser.json() globally,
      // which consumes the request stream before we get here. If req.body is already
      // populated, use it directly — attempting getRawBody on an already-consumed
      // stream will hang until the timeout fires.
      if (req.body !== undefined && req.body !== null &&
          (typeof req.body === 'object' ? Object.keys(req.body).length > 0 : String(req.body).trim().length > 0)) {
        hasBody = true;
        requestData = req.body;
        console.log(`📋 Using pre-parsed body from Express middleware, keys:`, typeof requestData === 'object' ? Object.keys(requestData) : '[string]');
      } else {
        // Body not yet parsed — read raw stream (e.g. text/plain, or when running
        // without the custom Express wrapper in production/test).
        console.log(`📋 Reading request body for ${method} request... Content-Length: ${req.headers['content-length']}`);
        try {
          const bodyPromise = getRawBody(req, {
            length: req.headers['content-length'],
            limit: '50mb',
            encoding: 'utf-8',
          });

          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Body read timeout after 30s')), 30000);
          });

          const rawBody = await Promise.race([bodyPromise, timeoutPromise]);

          console.log(`📋 Body read complete, length: ${rawBody.length}`);

          if (rawBody && rawBody.trim()) {
            hasBody = true;
            try {
              requestData = JSON.parse(rawBody);
              console.log(`📋 Parsed JSON body successfully:`, Object.keys(requestData));
            } catch (e) {
              console.log(`📋 Body is not JSON, using as-is`);
              requestData = rawBody;
            }
          } else {
            console.log(`⚠️ Empty body received for ${method} request`);
          }
        } catch (err) {
          console.error(`❌ Body read error:`, err.message);
          if (req.headers['content-length'] && parseInt(req.headers['content-length']) > 0) {
            return res.status(400).json({ error: 'Failed to read request body', message: err.message });
          }
        }
      }
    }
    
    // Build headers - only set Content-Type if there's a body
    const headers = {
      // Forward authorization header if present
      ...(req.headers.authorization && { 'Authorization': req.headers.authorization }),
    };
    
    // Only set Content-Type if there's actual content
    if (hasBody && contentType) {
      headers['Content-Type'] = contentType;
    } else if (hasBody && !contentType) {
      headers['Content-Type'] = 'application/json';
    }
    
    // Forward the request to the backend
    const axiosConfig = {
      method,
      url: targetUrl,
      params: query,
      headers,
      timeout: 600000, // 10 minute timeout to match backend
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    };
    
    // Only include data if there's actually a body
    if (hasBody) {
      axiosConfig.data = requestData;
    }
    
    const response = await axios(axiosConfig);

    console.log(`✅ Backend response:`, response.status);

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Return the response
    res.status(response.status).json(response.data);
  } catch (error) {
    // Suppress error logging if client disconnected (expected behavior for long-running requests)
    if (res.destroyed || res.headersSent) {
      // Client disconnected - this is expected for long-running extractions, suppress error
      return;
    }
    
    // Only log errors if client is still connected
    console.error('Policy research proxy error:', error.message);
    if (error.stack) {
    console.error('Error stack:', error.stack);
    }
    
    try {
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
    } catch (err) {
      console.error('Error sending error response:', err);
    }
  }
}


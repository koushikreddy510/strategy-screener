/**
 * Proxy API requests to the backend during local development.
 * When REACT_APP_API_URL is not set, the frontend uses relative URLs (same origin).
 * The dev server runs on port 3000, so /financials, /strategies, etc. would 404.
 * This proxy forwards those paths to the backend at localhost:8000.
 */
const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function (app) {
  app.use(
    createProxyMiddleware(
      /^\/(strategies|run|indicators|ohlc|chart|sectors|patterns|financials|conditions|admin)/,
      {
        target: 'http://localhost:8000',
        changeOrigin: true,
      }
    )
  );
};

/**
 * Proxy API requests to the backend during local development.
 * When REACT_APP_API_URL is not set, the frontend uses relative URLs (same origin).
 * The dev server runs on port 3000, so /financials, /strategies, etc. would 404.
 * This proxy forwards those paths to the backend at localhost:8000.
 */
const { createProxyMiddleware } = require('http-proxy-middleware');

// http-proxy-middleware v2+ does not accept RegExp as context (only string, glob, array, or function).
const BACKEND_PREFIX = /^(?:\/strategies|\/run|\/indicators|\/ohlc|\/chart|\/sectors|\/patterns|\/financials|\/conditions|\/admin)(?:\/|$|\?)/;

module.exports = function (app) {
  app.use(
    createProxyMiddleware(
      (pathname) => BACKEND_PREFIX.test(pathname),
      {
        target: 'http://localhost:8000',
        changeOrigin: true,
      }
    )
  );
};

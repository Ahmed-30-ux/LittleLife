const serverless = require('serverless-http');
const { createApp } = require('../../server');

const app = createApp();

exports.handler = serverless(app, {
  request: function(request, event, context) {
    // Netlify strips function base path, leaving /echo instead of /api/echo
    // Prepend /api so Express routes match
    if (request.url && !request.url.startsWith('/api')) {
      request.url = '/api' + request.url;
    }
  }
});

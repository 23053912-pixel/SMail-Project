'use strict';

const PORT     = parseInt(process.env.PORT || '3000', 10);
const BASE_URL = process.env.RENDER_EXTERNAL_URL
              || process.env.BASE_URL
              || `http://localhost:${PORT}`;

// Fail fast if JWT_SECRET is missing — otherwise jwt.verify uses undefined as the secret
if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set. Authentication will not work.');
}

module.exports = { PORT, BASE_URL };

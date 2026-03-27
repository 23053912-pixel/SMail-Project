'use strict';

const PORT     = parseInt(process.env.PORT || '3000', 10);
const BASE_URL = process.env.RENDER_EXTERNAL_URL
              || process.env.BASE_URL
              || `http://localhost:${PORT}`;

module.exports = { PORT, BASE_URL };

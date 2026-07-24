'use strict';

/**
 * Email Routes — Aggregator
 * Mounts sub-routers for each email operation domain.
 * Split from monolithic emailsRestructured.js for maintainability.
 */

const express = require('express');
const emailCrudRouter   = require('./email-crud');
const emailSendRouter   = require('./email-send');
const emailScanRouter   = require('./email-scan');
const emailListRouter   = require('./email-list');

const router = express.Router();

// ── Mount sub-routers ────────────────────────────────────────────────────────
// Order matters: more specific routes before parameterized routes
router.use('/', emailListRouter);    // /user, /emails/*, /drafts
router.use('/', emailSendRouter);    // /send, /draft
router.use('/', emailScanRouter);    // /email/:id/scan, /emails/inbox/auto-spam-scan
router.use('/', emailCrudRouter);    // /email/:id, /email/:id/star, etc.

module.exports = router;

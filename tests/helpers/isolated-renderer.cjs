'use strict';
const assert = require('node:assert/strict');
const { runIsolatedWebView, recordNativeVisualAssertions } = require('./isolated-webview-runner.cjs');
const { runIsolatedEdge } = require('./isolated-edge-runner.cjs');

// Explicit backends; a failed engine is never silently retried on another one.
async function runIsolatedRenderer(options) {
  const backend = process.env.ZHIKE_VISUAL_BACKEND || 'webview2';
  assert.ok(['webview2', 'edge'].includes(backend), 'Unknown visual renderer backend');
  return backend === 'webview2' ? runIsolatedWebView(options) : runIsolatedEdge(options);
}

module.exports = { runIsolatedRenderer, recordVisualAssertions: recordNativeVisualAssertions };

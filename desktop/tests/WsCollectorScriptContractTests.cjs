'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const host = fs.readFileSync(path.join(repo, 'desktop', 'src', 'Zhike.Desktop', 'Views', 'LegacyUiHostPage.xaml.cs'), 'utf8');
const match = host.match(/return \$\$"""([\s\S]*?)""";/);
assert.ok(match, 'WS collector raw script must remain embedded in the native host');
const script = match[1].replace(/\{\{encodedAccount\}\}/g, JSON.stringify('default'));
assert.doesNotThrow(() => new Function(script), 'embedded WS collector script must be valid JavaScript');
for (const token of [
  'requestAnimationFrame(() => requestAnimationFrame',
  'container.dispatchEvent(new Event(\'scroll\'',
  'scan-in-progress',
  'page-list-scanned',
  'lastMessageFingerprint',
  'scopedRowSelectors',
  'Prefer the actual chat-list root',
  'const compact = conversations.slice(0, maxConversationCount())',
  'maxConversationCount',
  'LIST_SCAN_DEADLINE_MS',
  'estimatedRounds',
  'scrollHeight',
  'page-list-limit',
  '1.2 MB',
  'const MAX_BYTES = 600000',
  'splitWithinLimit',
  'chunkIndex:index',
  'chunkCount:packets.length',
  'previewText',
  'scheduleAllScan',
  'markListInteraction',
  'lastListInteractionAt',
  "window.addEventListener('wheel'",
  'window.__zhikeStopCapture',
  'window.__zhikeWsAcknowledgeHistory',
  "event:'collection-complete'",
]) assert.match(script, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `collector missing ${token}`);

assert.doesNotMatch(script, /stableRounds\s*>=\s*8/, '完整历史不能在固定 8 次滚动后静默截断');
assert.doesNotMatch(script, /Date\.now\(\)\s*-\s*run\.startedAt\s*>\s*120000/, '账号级采集不能在 120 秒后静默宣布结束');

console.log('WS native collector contract: virtualized full-list scan yields across frames, restores scroll and schedules background scans');

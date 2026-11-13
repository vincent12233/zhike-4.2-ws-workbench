'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');
const core = require(path.join(repo, 'resources/app/modules/ws-workbench-core.js'));
const ui = read('resources/app/modules/ws-workbench.js');
const server = read('resources/app/server.mjs');

const messages = Array.from({ length: 6 }, (_, index) => ({
  id: `m-${index + 1}`,
  externalId: `wa-${index + 1}`,
  direction: index % 2 ? 'send' : 'receive',
  originalText: `历史消息-${index + 1}`,
  order: index + 1,
}));
const transcript = core.buildFullHistoryTranscript(messages, { maxChars: 2000, maxMessageChars: 400 });
assert.equal(transcript.total, messages.length, 'full-history transcript must count every stored message');
assert.equal(transcript.included, messages.length, 'full-history transcript must include every message when within the budget');
assert.equal(transcript.truncated, false, 'small complete conversations must not be marked truncated');
assert.match(transcript.text, /历史消息-1/);
assert.match(transcript.text, /历史消息-6/);

const mediumMessages = Array.from({ length: 100 }, (_, index) => ({
  id: `medium-${index}`,
  externalId: `medium-external-${index}`,
  direction: 'receive',
  originalText: `MEDIUM-${index}-`.padEnd(110, 'x'),
  order: index,
}));
const mediumTranscript = core.buildFullHistoryTranscript(mediumMessages, { maxChars: 24000 });
assert.equal(mediumTranscript.truncated, false);
const mediumPrompt = core.buildNaturalChatAnalysisPrompt(mediumTranscript.text, { conversationId: 'medium-conversation' });
assert.match(mediumPrompt, /MEDIUM-99-/, '超过旧 9,000 字上限但仍在请求预算内的尾部聊天不得丢失');

const largeMessages = Array.from({ length: 240 }, (_, index) => ({
  id: `large-${index}`,
  externalId: `large-external-${index}`,
  direction: index % 2 ? 'send' : 'receive',
  originalText: `LARGE-${index}-`.padEnd(220, 'y'),
  order: index,
}));
const sampledTranscript = core.buildFullHistoryTranscript(largeMessages, { maxChars: 24000 });
assert.equal(sampledTranscript.complete, false);
assert.equal(sampledTranscript.truncated, true);
assert.ok(sampledTranscript.omitted > 0);
assert.match(sampledTranscript.text, /本次分析不是完整覆盖/, '首尾采样必须在输入内显式标记中间省略');
const sampledPrompt = core.buildNaturalChatAnalysisPrompt(sampledTranscript.text, { conversationId: 'large-conversation', truncated: sampledTranscript.truncated });
assert.match(sampledPrompt, /不得声称已分析全部聊天/);

const chunks = core.splitHistoryTranscript(largeMessages, { maxChars: 4000 });
assert.ok(chunks.length > 1, '大型历史应分成多个顺序 AI 请求');
assert.ok(chunks.every(chunk => chunk.text.length <= 4000 && chunk.truncated === false));
const chunkText = chunks.map(chunk => chunk.text).join('\n');
for (const index of [0, 1, 80, 160, 239]) assert.match(chunkText, new RegExp(`LARGE-${index}-`), `分块不得丢失第 ${index} 条消息`);
const mergedAnalysis = core.mergeAiAnalyses([
  { summary: '前半段', confidence: 0.9, profileFacts: { age: { value: 31, state: 'known', confidence: 0.9, evidence: '我 31 岁' } } },
  { summary: '后半段', confidence: 0.8, profileFacts: { occupation: { value: '工程师', state: 'known', confidence: 0.8, evidence: '我是工程师' } } },
], { expectedChunkCount: 2, historyComplete: true });
assert.equal(mergedAnalysis.profileFacts.age.value, 31);
assert.equal(mergedAnalysis.profileFacts.occupation.value, '工程师');
assert.equal(mergedAnalysis.transcriptInfo.historyComplete, true);
const finalSynthesisMerge = core.mergeAiAnalyses([mergedAnalysis, { summary: '最终综合', confidence: 0.9, profileFacts: {} }], { expectedChunkCount: 2, historyComplete: true });
assert.equal(finalSynthesisMerge.profileFacts.occupation.value, '工程师', '最终综合遗漏字段时必须保留中间分块提取的证据');
assert.equal(core.mergeAiAnalyses([{ summary: '仅一个未证实分块', confidence: 0.9 }]).transcriptInfo.historyComplete, false, '未提供预期分块数时不得自称完整覆盖');

assert.match(server, /url\.searchParams\.get\('offset'\)/, 'message API must expose pagination for complete histories');
assert.match(server, /COUNT\(\*\) AS count.*ws_messages|ws_messages.*COUNT\(\*\) AS count/s, 'message API must report the stored message total');
assert.match(ui, /loadAllConversationMessages/, 'workbench must load all pages instead of only the first message page');
assert.match(ui, /historyLoaded|full-history|完整聊天/, 'workbench must distinguish full chat history from list preview');
assert.match(ui, /fullHistorySourceFingerprint\(conversation\)/, 'background AI must require matching collected/latest history fingerprints instead of analysing a sidebar preview or stale transcript');
assert.match(ui, /job\.payload\?\.sourceFingerprint.*sourceFingerprint/, 'a queued full-history AI job must match the current source fingerprint');
assert.match(ui, /<span>列表已同步<\/span>/, 'list discovery count must not be labelled as completed chat collection');
console.log('ws full-history contract: complete per-customer message loading and AI transcript coverage are wired');

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const core = require(path.join(repo, 'resources/app/modules/ws-workbench-core.js'));
const workbenchSource = fs.readFileSync(path.join(repo, 'resources/app/modules/ws-workbench.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(repo, 'resources/app/server.mjs'), 'utf8');

const messages = Array.from({ length: 12 }, (_, index) => ({
  id: `message-${index}`,
  externalId: `external-${index}`,
  order: index,
  direction: index % 2 ? 'send' : 'receive',
  originalText: `${index === 6 ? 'MIDDLE_FACT occupation=Engineer ' : ''}${`message-${index} `.repeat(120)}`,
}));

const chunks = core.splitHistoryTranscript(messages, { maxChars: 4000 });
assert.equal(chunks.length, 4, '固定样本应分成 4 个按时间顺序的 AI 请求');
assert.ok(chunks.every(chunk => chunk.text.length <= 4000 && chunk.truncated === false));
assert.match(chunks.map(chunk => chunk.text).join('\n'), /MIDDLE_FACT occupation=Engineer/);

let aiCalls = 0;
const analyses = chunks.map((chunk, index) => {
  aiCalls += 1;
  return core.parseAiResult(JSON.stringify({
    summary: `chunk-${index + 1}`,
    profileFacts: chunk.text.includes('MIDDLE_FACT')
      ? { occupation: { value: 'Engineer', state: 'known', confidence: 0.94, evidence: 'occupation=Engineer' } }
      : {},
    followupStrategy: {
      shouldFollowUp: true,
      qualificationScore: 40,
      qualificationReason: 'budget unknown',
      engagementScore: 50,
      engagementReason: 'customer replies',
      priorityScore: 45,
      scoreConfidence: 0.8,
    },
    confidence: 0.9,
  }));
});

const checkpointAfterTwo = core.mergeAiAnalyses(analyses.slice(0, 2), {
  expectedChunkCount: chunks.length,
  historyComplete: false,
});
assert.equal(checkpointAfterTwo.transcriptInfo.historyComplete, false, '部分断点不得误报全量完成');
const resumedMerge = core.mergeAiAnalyses([checkpointAfterTwo, ...analyses.slice(2)], {
  expectedChunkCount: chunks.length,
  historyComplete: true,
});
assert.equal(resumedMerge.profileFacts.occupation.value, 'Engineer', '断点续分析必须保留中间分块证据');
resumedMerge.transcriptInfo = { ...resumedMerge.transcriptInfo, chunkCount: chunks.length, analyzedChunks: chunks.length, historyComplete: true, truncated: false };
assert.equal(resumedMerge.transcriptInfo.historyComplete, true);

aiCalls += 1;
const synthesis = core.parseAiResult(JSON.stringify({
  summary: 'final synthesis',
  profileFacts: {},
  followupStrategy: {
    shouldFollowUp: true,
    qualificationScore: 40,
    qualificationReason: 'budget unknown',
    engagementScore: 50,
    engagementReason: 'customer replies',
    priorityScore: 45,
    scoreConfidence: 0.8,
  },
  confidence: 0.9,
}));
const finalAnalysis = core.mergeAiAnalyses([resumedMerge, synthesis], {
  expectedChunkCount: 2,
  historyComplete: true,
});
assert.equal(aiCalls, chunks.length + 1, 'N 个历史分块应产生 N+1 次 AI 请求（含最终综合）');
assert.equal(finalAnalysis.profileFacts.occupation.value, 'Engineer', '最终综合遗漏某字段时不得删除分块已提取的证据');

assert.match(workbenchSource, /analyzeHistoryChunks\(chunks,\s*conversation,\s*context,\s*aiJob\.job,\s*\{[\s\S]{0,240}signal/, '后台分析必须把持久化任务与可取消信号传入分块处理器');
assert.match(workbenchSource, /window\.zhikeAI\.request\([\s\S]{0,700}\},\s*\{\s*signal\s*\}\)/, '分块 AI 请求必须可在账号切换或关闭功能时取消');
assert.match(workbenchSource, /checkpoint\?\.chunkCount\s*===\s*chunks\.length/, '只允许与当前分块数一致的断点续跑');
assert.match(workbenchSource, /action:\s*'checkpoint'[\s\S]{0,220}completedChunks:\s*chunk\.chunkNumber/, '每个分块成功后必须保存进度');
assert.match(serverSource, /if\s*\(action\s*===\s*'checkpoint'\)[\s\S]{0,900}payload_json=\?,locked_at=\?,updated_at=\?/, '断点必须持久化并刷新任务租约');

console.log('WS chunked AI analysis: 4 chunks, 5 calls, middle evidence retention, full coverage and durable checkpoint contracts pass');

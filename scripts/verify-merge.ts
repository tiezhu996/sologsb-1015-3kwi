// 合流规则验证（Node 直跑，不依赖浏览器）
import assert from 'node:assert/strict';
import { MergeEngine, threeWayAlign, markKey, lineChars } from '../src/app/services/merge-engine';
import type { MergeBatch, PoemVersion, CandidateMark } from '../src/app/models/poem.models';

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

const cand = (tone: CandidateMark['tone'], basis = '刻本'): CandidateMark => ({ tone, rhyme: '', pauseAfter: false, basis, note: '' });

function makeVersion(text: string): PoemVersion {
  return {
    id: 'v1', name: '当前稿', source: '通行本', createdAt: '', text,
    marks: {
      '0:4': { tone: '仄', rhyme: 'A', pauseAfter: false, basis: '平水韵', note: '', status: 'confirmed' },
      '1:4': { tone: '仄', rhyme: 'A', pauseAfter: false, basis: '平水韵', note: '', status: 'confirmed' },
      '2:4': { tone: '平', rhyme: 'A', pauseAfter: false, basis: '平水韵', note: '', status: 'confirmed' },
      '3:4': { tone: '仄', rhyme: 'A', pauseAfter: false, basis: '平水韵', note: '', status: 'confirmed' },
    },
    antithesisPairs: [],
  };
}

const baseText = '春眠不觉晓\n处处闻啼鸟\n夜来风雨声\n花落知多少';

function makeBatch(overrides: Partial<MergeBatch> = {}): MergeBatch {
  return {
    id: 'batch-1',
    sourceName: '宋蜀刻本',
    sourceRef: 'SN-001',
    targetVersionId: 'v1',
    createdAt: '',
    status: 'open',
    sourceLines: baseText.split('\n'),
    draftSnapshot: baseText.split('\n'),
    sourceMarks: {
      '2:1': cand('平', '广韵'),
      '0:4': cand('仄', '刻本朱点'), // 未改字也有候选：不应覆盖当前稿
    },
    antithesisSuggestions: [],
    conflictChoices: {},
    ...overrides,
  };
}

// ---------- 行级对齐 ----------
test('行级三路对齐：来源与当前稿改同一行，归入同一对照行且标记双方行号', () => {
  // 同改同字位且保留两个共同字，LCS 才能锚定到基准行（删/换字在行内逐字层处理）
  const rows = threeWayAlign(
    ['AAA', 'BCDE'],
    ['AAA', 'BXDE'],
    ['AAA', 'BCYE'],
  );
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1], { base: 1, source: 1, draft: 1 });
});

test('行级三路对齐：一侧删行时另一侧仍保留该行（draft-only）；改行可识别', () => {
  // 来源删掉第二行；当前稿在第三行改字
  const rows = threeWayAlign(
    ['AAA', 'BBB', 'CCC'],
    ['AAA', 'CCC'],
    ['AAA', 'BBB', 'CXC'],
  );
  // 被删行：仅 draft 侧存在
  const deletedRow = rows.find((r) => r.base === 1);
  assert.deepEqual(deletedRow, { base: 1, source: null, draft: 1 });
  // 第三行：来源行号因删行前移为 1
  const changedRow = rows.find((r) => r.base === 2);
  assert.deepEqual(changedRow, { base: 2, source: 1, draft: 2 });
});

test('行级三路对齐：来源新增行与当前稿新增行并列', () => {
  const rows = threeWayAlign(['AAA'], ['AAA', 'CCC'], ['AAA', 'DDD']);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { base: 0, source: 0, draft: 0 });
  assert.deepEqual(rows[1], { base: null, source: 1, draft: 1 });
});

// ---------- 仅来源改动 ----------
test('仅来源改动：预览识别 source，待复核数=真正改的字数', () => {
  const engine = new MergeEngine();
  const sourceText = '春眠不觉晓\n处处闻啼鸟\n夜阑风雨声\n花落知多少';
  const batch = makeBatch({ sourceLines: sourceText.split('\n') });
  const version = makeVersion(baseText);
  const preview = engine.preview(batch, version);
  const changedLine = preview.lines.find((l) => l.state === 'source');
  assert.ok(changedLine, '第三句应识别为仅来源改动');
  assert.equal(preview.pendingCount, 1, '只有“来→阑”一个真正改动字');
  const changedCell = changedLine!.cells.find((c) => c.status === 'source');
  assert.equal(changedCell?.sourceChar, '阑');
  assert.equal(changedCell?.draftChar, '来');
});

test('合流执行：改动字带候选转待复核；未改字保留当前稿标注、候选不覆盖', () => {
  const engine = new MergeEngine();
  const sourceText = '春眠不觉晓\n处处闻啼鸟\n夜阑风雨声\n花落知多少';
  const batch = makeBatch({ sourceLines: sourceText.split('\n') });
  const version = makeVersion(baseText);
  const preview = engine.preview(batch, version);
  const result = engine.apply(batch, preview, version);
  assert.equal(result.ok, true);
  assert.equal(result.text!.split('\n')[2], '夜阑风雨声');
  const changed = result.marks![markKey(2, 1)];
  assert.equal(changed.status, 'pending');
  assert.equal(changed.candidate?.tone, '平');
  assert.equal(changed.candidate?.basis, '广韵');
  assert.equal(changed.originSource, '宋蜀刻本');
  // 未改字：照旧，且不被来源候选覆盖
  const untouched = result.marks![markKey(0, 4)];
  assert.equal(untouched.status, 'confirmed');
  assert.equal(untouched.basis, '平水韵');
  assert.equal(untouched.candidate, undefined);
});

// ---------- 两边同改同一句：冲突 ----------
test('两边同改同一句：标记冲突、并列保留；未决前合流失败', () => {
  const engine = new MergeEngine();
  const sourceText = baseText.replace('夜来', '夜阑');
  const draftText = baseText.replace('夜来', '夜看');
  const batch = makeBatch({ sourceLines: sourceText.split('\n') });
  const version = makeVersion(draftText);
  const preview = engine.preview(batch, version);
  const conflictLine = preview.lines.find((l) => l.state === 'conflict');
  assert.ok(conflictLine);
  assert.equal(preview.ready, false);
  const cell = conflictLine!.cells.find((c) => c.conflict);
  assert.equal(cell?.sourceChar, '阑');
  assert.equal(cell?.draftChar, '看');
  const failed = engine.apply(batch, preview, version);
  assert.equal(failed.ok, false);
  assert.match(failed.error!, /冲突句/);
});

test('冲突句选定来源后合流采用来源字；选定当前稿则保留当前字', () => {
  const engine = new MergeEngine();
  const sourceText = baseText.replace('夜来', '夜阑');
  const draftText = baseText.replace('夜来', '夜看');
  const batch = makeBatch({ sourceLines: sourceText.split('\n'), conflictChoices: {} });
  const version = makeVersion(draftText);

  batch.conflictChoices![engine.preview(batch, version).lines.find((l) => l.state === 'conflict')!.rowKey] = 'source';
  const previewSource = engine.preview(batch, version);
  assert.equal(previewSource.ready, true);
  const pickedSource = engine.apply(batch, previewSource, version);
  assert.equal(pickedSource.ok, true);
  assert.equal(pickedSource.text!.split('\n')[2], '夜阑风雨声');
  assert.equal(pickedSource.pendingPositions!.length, 1);

  batch.conflictChoices![previewSource.lines.find((l) => l.state === 'conflict')!.rowKey] = 'draft';
  const previewDraft = engine.preview(batch, version);
  const pickedDraft = engine.apply(batch, previewDraft, version);
  assert.equal(pickedDraft.text!.split('\n')[2], '夜看风雨声');
  assert.equal(pickedDraft.pendingPositions!.length, 0, '选当前稿：无来源改动字，不新增待复核');
});

// ---------- 对仗建议 ----------
test('对仗建议：仅接受项按新行号写入，拒绝项丢弃', () => {
  const engine = new MergeEngine();
  const sourceText = baseText.replace('夜来', '夜阑');
  const batch = makeBatch({
    sourceLines: sourceText.split('\n'),
    antithesisSuggestions: [
      { id: 's1', leftLine: 1, rightLine: 2, note: '候选对', decision: 'accept' },
      { id: 's2', leftLine: 0, rightLine: 3, note: '拒绝项', decision: 'reject' },
    ],
  });
  const version = makeVersion(baseText);
  const result = engine.apply(batch, engine.preview(batch, version), version);
  assert.equal(result.antithesisPairs!.length, 1);
  assert.deepEqual([result.antithesisPairs![0].leftLine, result.antithesisPairs![0].rightLine], [1, 2]);
});

// ---------- 标点不参与对齐 ----------
test('标点被剔除：仅标点差异不算改动', () => {
  const engine = new MergeEngine();
  const punctuated = '春眠不觉晓，\n处处闻啼鸟。\n夜来风雨声，\n花落知多少。';
  const batch = makeBatch({ sourceLines: punctuated.split('\n') });
  const version = makeVersion(baseText);
  const preview = engine.preview(batch, version);
  assert.equal(preview.conflicts + preview.sourceOnly + preview.draftOnly, 0);
  assert.equal(preview.pendingCount, 0);
  const result = engine.apply(batch, preview, version);
  assert.equal(result.ok, true);
});

// ---------- 行内插入（新增字）----------
test('来源句新增字：source-insert 字转待复核，旧字标注保留', () => {
  const engine = new MergeEngine();
  const longer = '春眠不觉晓\n处处闻啼鸟\n夜来风雨声声\n花落知多少';
  const batch = makeBatch({ sourceLines: longer.split('\n') });
  const version = makeVersion(baseText);
  const preview = engine.preview(batch, version);
  const result = engine.apply(batch, preview, version);
  assert.equal(result.ok, true);
  assert.ok(result.text!.includes('夜来风雨声声'));
  const pendings = result.pendingPositions!;
  assert.ok(pendings.some((p) => p.line === 2), '新增字应转待复核');
  assert.equal(result.marks![markKey(2, 5)]?.status, 'confirmed', '原韵脚“声”随新增字挪到第6位，标注照旧');
  assert.equal(result.marks![markKey(2, 5)]?.basis, '平水韵');
});

console.log(`\n合并引擎：${passed} 项全部通过`);

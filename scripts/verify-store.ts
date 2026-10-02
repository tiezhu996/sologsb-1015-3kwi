// Store 合流行为验证（Node 直跑，localStorage 用内存桩）
import assert from 'node:assert/strict';
import { PoetryStoreService } from '../src/app/services/poetry-store.service';
import type { BatchImportPayload } from '../src/app/services/poetry-store.service';
import { markKey } from '../src/app/services/merge-engine';

// localStorage 内存桩
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
}
(globalThis as { localStorage?: MemoryStorage }).localStorage = new MemoryStorage();

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

const baseText = '春眠不觉晓\n处处闻啼鸟\n夜来风雨声\n花落知多少';

function freshStore(): PoetryStoreService {
  (globalThis as { localStorage: MemoryStorage }).localStorage.clear();
  return new PoetryStoreService();
}

const examplePayload = (text: string): BatchImportPayload => ({
  sourceName: '宋蜀刻本',
  sourceRef: 'SN-001',
  text,
  marks: { '2:1': { tone: '平', rhyme: '', pauseAfter: false, basis: '广韵', note: '阑，平声' } },
  antithesis: [{ leftLine: 1, rightLine: 2, note: '次联候选对仗' }],
});

test('正文改字：旧位置标注失效重算，仅改动字转待复核并保留旧值候选，别处照旧', () => {
  const store = freshStore();
  // 把韵脚“声”改成“生”（该位置原本有 confirmed 人工标注）
  store.updateText(baseText.replace('风雨声', '风雨生'));
  const marks = store.activeVersion().marks;
  const changed = marks[markKey(2, 4)];
  assert.equal(changed.status, 'pending');
  assert.equal(changed.originSource, '正文改动');
  assert.ok(changed.candidate, '旧标注保留为候选');
  assert.equal(changed.candidate!.rhyme, 'A');
  // 未改字照旧
  assert.equal(marks[markKey(2, 2)]?.status, 'confirmed');
  assert.equal(marks[markKey(0, 4)]?.basis, '《平水韵》上声十七筱');
  assert.equal(store.pendingCount(), 1);
});

test('新增整句：整句各字转待复核；原后续行标注按新行号搬迁', () => {
  const store = freshStore();
  store.updateText(`${baseText}\n孤云独去闲`);
  const marks = store.activeVersion().marks;
  assert.equal(marks[markKey(4, 0)]?.status, 'pending');
  // 原第四句仍在原位（行3），韵脚“少”保持 confirmed
  assert.equal(marks[markKey(3, 4)]?.status, 'confirmed');
  assert.equal(marks[markKey(3, 4)]?.rhyme, 'A');
  // 新增第五句各字待复核
  assert.equal(marks[markKey(4, 4)]?.status, 'pending');
});

test('导入批次不改当前稿；导入后两边同改同一句，执行合流失败，批次与已确认选择保留', () => {
  const store = freshStore();
  const textAtImport = store.activeVersion().text;
  // 先导入（快照 = 夜来…），来源为 夜阑…
  const importResult = store.importBatch(examplePayload(baseText.replace('夜来', '夜阑')));
  assert.equal(importResult.ok, true);
  assert.equal(store.activeVersion().text, textAtImport, '导入后当前稿正文不变');
  // 导入后当前稿再改同一句 → 两边同改
  store.updateText(baseText.replace('夜来', '夜看'));
  const textBefore = store.activeVersion().text;
  const preview = store.mergePreview()!;
  assert.equal(preview.conflicts, 1);
  assert.equal(preview.ready, false);

  // 未决直接合流 → 失败
  store.commitMerge();
  const batch = store.activeBatch()!;
  assert.equal(batch.status, 'failed');
  assert.match(batch.lastError!, /冲突句/);
  // 失败后仍可记录选择，且选择被保留
  const conflict = store.mergePreview()!.lines.find((l) => l.state === 'conflict')!;
  store.chooseConflict(conflict.rowKey, 'source');
  assert.equal(store.activeBatch()!.conflictChoices![conflict.rowKey], 'source', '已确认选择保留');
  // 重试不重复生成批次：仍是同一个
  const batches = store.workspace().mergeBatches!;
  assert.equal(batches.length, 1);
  assert.equal(store.activeVersion().text, textBefore, '失败后当前稿仍未被覆盖');
});

test('失败后用同一批次完成决择并重试合流成功：改动字待复核、其余照旧', () => {
  const store = freshStore();
  store.importBatch(examplePayload(baseText.replace('夜来', '夜阑')));
  store.updateText(baseText.replace('夜来', '夜看'));
  const conflict = store.mergePreview()!.lines.find((l) => l.state === 'conflict')!;
  // 第一次失败（不选）
  store.commitMerge();
  assert.equal(store.activeBatch()!.status, 'failed');
  // 重试：选择来源
  store.chooseConflict(conflict.rowKey, 'source');
  store.commitMerge();
  assert.equal(store.workspace().mergeBatches!.length, 1, '重试不重复生成批次');
  assert.equal(store.activeVersion().text.split('\n')[2], '夜阑风雨声');
  const pending = store.pendingReview();
  assert.ok(pending.some((p) => p.char === '阑'));
  assert.equal(store.pendingBySource()[0].source, '宋蜀刻本');
});

test('对仗建议默认不写入；接受后才随合流写入', () => {
  const store = freshStore();
  store.importBatch(examplePayload(baseText.replace('夜来', '夜阑')));
  assert.equal(store.activeVersion().antithesisPairs.length, 0);
  store.commitMerge();
  assert.equal(store.activeVersion().antithesisPairs.length, 0, '未接受的建议不写入');

  (globalThis as { localStorage: MemoryStorage }).localStorage.clear();
  const store2 = new PoetryStoreService();
  store2.importBatch(examplePayload(baseText.replace('夜来', '夜阑')));
  const sug = store2.activeBatch()!.antithesisSuggestions[0];
  store2.setSuggestionDecision(sug.id, 'accept');
  store2.commitMerge();
  assert.equal(store2.activeVersion().antithesisPairs.length, 1);
  assert.deepEqual(
    [store2.activeVersion().antithesisPairs[0].leftLine, store2.activeVersion().antithesisPairs[0].rightLine],
    [1, 2],
  );
});

test('采用候选即确认，待复核数量归零；按当前值确认也归零', () => {
  const store = freshStore();
  store.importBatch(examplePayload(baseText.replace('夜来', '夜阑')));
  store.commitMerge();
  assert.equal(store.pendingCount(), 1);
  const p = store.pendingReview()[0];
  store.selectCell(p.line, p.position);
  store.adoptCandidate();
  assert.equal(store.pendingCount(), 0);
  assert.equal(store.activeVersion().marks[markKey(p.line, p.position)]?.tone, '平');
});

test('撤销可以回到合流前；重做恢复', () => {
  const store = freshStore();
  store.importBatch(examplePayload(baseText.replace('夜来', '夜阑')));
  store.commitMerge();
  assert.equal(store.activeVersion().text.includes('夜阑'), true);
  assert.equal(store.pendingCount(), 1);
  // 撤销多次直到回到合流前（合流、冲突选择等各一次提交）
  store.undo();
  // 一次撤销即应回退 commitMerge 那次提交
  assert.equal(store.activeVersion().text.includes('夜阑'), false, '撤销回到合流前正文');
  assert.equal(store.pendingCount(), 0);
  assert.equal(store.workspace().mergeBatches!.length, 1, '批次仍保留');
  store.redo();
  assert.equal(store.activeVersion().text.includes('夜阑'), true);
  assert.equal(store.pendingCount(), 1);
});

test('导出稿包含待复核数量与来源', () => {
  const store = freshStore();
  store.importBatch(examplePayload(baseText.replace('夜来', '夜阑')));
  store.commitMerge();
  const md = store.exportProofreadCopy();
  assert.match(md, /共 1 字待复核/);
  assert.match(md, /宋蜀刻本/);
  assert.match(md, /待复核·宋蜀刻本/);
});

console.log(`\nStore 行为：${passed} 项全部通过`);

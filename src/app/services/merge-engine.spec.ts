import { TestBed } from '@angular/core/testing';
import { MergeEngine } from './merge-engine';
import type { MergeBatch, PoemVersion } from '../models/poem.models';

describe('MergeEngine · 宋刻本三路合流', () => {
  let engine: MergeEngine;
  const baseText = '春眠不觉晓\n处处闻啼鸟\n夜来风雨声\n花落知多少';

  const makeVersion = (text: string): PoemVersion => ({
    id: 'v1',
    name: '当前稿',
    source: '通行本',
    createdAt: '',
    text,
    marks: {
      '2:4': { tone: '平', rhyme: 'A', pauseAfter: false, basis: '平水韵', note: '', status: 'confirmed' },
    },
    antithesisPairs: [],
  });

  const makeBatch = (sourceText: string, overrides: Partial<MergeBatch> = {}): MergeBatch => ({
    id: 'batch-1',
    sourceName: '宋蜀刻本',
    sourceRef: 'SN-001',
    targetVersionId: 'v1',
    createdAt: '',
    status: 'open',
    sourceLines: sourceText.split('\n'),
    draftSnapshot: baseText.split('\n'),
    sourceMarks: { '2:1': { tone: '平', rhyme: '', pauseAfter: false, basis: '广韵', note: '' } },
    antithesisSuggestions: [],
    conflictChoices: {},
    ...overrides,
  });

  beforeEach(() => {
    TestBed.runInInjectionContext(() => {
      engine = new MergeEngine();
    });
  });

  it('仅来源改字：只有真正改的字计入待复核', () => {
    const batch = makeBatch(baseText.replace('夜来', '夜阑'));
    const preview = engine.preview(batch, makeVersion(baseText));
    expect(preview.pendingCount).toBe(1);
    expect(preview.conflicts).toBe(0);
  });

  it('合流后改动字带候选转待复核，未改字保留当前稿标注且候选不覆盖', () => {
    const version = makeVersion(baseText);
    version.marks['0:4'] = { tone: '仄', rhyme: 'A', pauseAfter: false, basis: '平水韵', note: '', status: 'confirmed' };
    const batch = makeBatch(baseText.replace('夜来', '夜阑'), {
      sourceMarks: {
        '2:1': { tone: '平', rhyme: '', pauseAfter: false, basis: '广韵', note: '' },
        '0:4': { tone: '平', rhyme: 'A', pauseAfter: false, basis: '刻本朱点', note: '' },
      },
    });
    const result = engine.apply(batch, engine.preview(batch, version), version);
    expect(result.ok).toBeTrue();
    expect(result.marks!['2:1'].status).toBe('pending');
    expect(result.marks!['2:1'].candidate?.basis).toBe('广韵');
    expect(result.marks!['0:4'].basis).toBe('平水韵');
    expect(result.marks!['0:4'].candidate).toBeUndefined();
  });

  it('两边同改同一句：并列保留为冲突，未决不合流', () => {
    const batch = makeBatch(baseText.replace('夜来', '夜阑'));
    const version = makeVersion(baseText.replace('夜来', '夜看'));
    const preview = engine.preview(batch, version);
    expect(preview.conflicts).toBe(1);
    expect(preview.ready).toBeFalse();
    expect(engine.apply(batch, preview, version).ok).toBeFalse();
  });

  it('选定来源前不覆盖当前稿；选定后按所选合流', () => {
    const batch = makeBatch(baseText.replace('夜来', '夜阑'));
    const version = makeVersion(baseText.replace('夜来', '夜看'));
    const rowKey = engine.preview(batch, version).lines.find((l) => l.state === 'conflict')!.rowKey;
    batch.conflictChoices = { [rowKey]: 'source' };
    const result = engine.apply(batch, engine.preview(batch, version), version);
    expect(result.ok).toBeTrue();
    expect(result.text!.split('\n')[2]).toBe('夜阑风雨声');
  });

  it('对仗建议仅写入明确接受项', () => {
    const batch = makeBatch(baseText.replace('夜来', '夜阑'), {
      antithesisSuggestions: [
        { id: 's1', leftLine: 1, rightLine: 2, note: '接受', decision: 'accept' },
        { id: 's2', leftLine: 0, rightLine: 3, note: '拒绝', decision: 'reject' },
      ],
    });
    const version = makeVersion(baseText);
    const result = engine.apply(batch, engine.preview(batch, version), version);
    expect(result.antithesisPairs?.length).toBe(1);
  });
});

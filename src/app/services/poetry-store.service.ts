import { computed, Injectable, signal } from '@angular/core';
import type {
  AntithesisPair,
  AnalysisCell,
  AnalysisLine,
  CandidateMark,
  CharacterMark,
  CharDiff,
  MarkTone,
  MergeBatch,
  MergePreview,
  MeterTemplate,
  PendingPosition,
  PoemIssue,
  PoemVersion,
  PoemWorkspace,
  Tone,
} from '../models/poem.models';
import { MergeEngine, alignThreeChars, lineChars, markKey, threeWayAlign } from './merge-engine';

export const METER_TEMPLATES: MeterTemplate[] = [
  {
    id: 'wuyan-zeqi',
    name: '五言绝句 · 仄起首句不入韵',
    summary: '四句，每句五字；二、四句押韵',
    lineCount: 4,
    lineLength: 5,
    pattern: ['仄', '仄', '中', '平', '仄', '中', '平', '中', '仄', '仄', '中', '平', '中', '仄', '中', '平', '中', '仄', '中', '平'],
    rhymeLines: [1, 3],
  },
  {
    id: 'wuyan-pingqi',
    name: '五言绝句 · 平起首句入韵',
    summary: '四句，每句五字；一、二、四句押韵',
    lineCount: 4,
    lineLength: 5,
    pattern: ['中', '平', '中', '仄', '平', '仄', '仄', '中', '平', '仄', '中', '平', '中', '仄', '仄', '中', '平', '仄', '中', '平'],
    rhymeLines: [0, 1, 3],
  },
  {
    id: 'qiyan-zeqi',
    name: '七言绝句 · 仄起首句入韵',
    summary: '四句，每句七字；一、二、四句押韵',
    lineCount: 4,
    lineLength: 7,
    pattern: ['仄', '仄', '中', '平', '中', '仄', '平', '中', '平', '中', '仄', '仄', '中', '平', '中', '仄', '中', '平', '中', '仄', '仄', '中', '平', '中', '仄', '中', '平', '中'],
    rhymeLines: [0, 1, 3],
  },
  {
    id: 'qiyan-pingqi',
    name: '七言绝句 · 平起首句不入韵',
    summary: '四句，每句七字；二、四句押韵',
    lineCount: 4,
    lineLength: 7,
    pattern: ['中', '平', '中', '仄', '仄', '中', '平', '仄', '仄', '中', '平', '平', '仄', '仄', '中', '平', '中', '仄', '中', '平', '仄', '仄', '中', '平', '中', '仄', '仄', '中', '平'],
    rhymeLines: [1, 3],
  },
];

const STORAGE_KEY = 'sologsb-1015-poetry-workspace-v2';
const PUNCTUATION = new Set(['，', '。', '！', '？', '；', '：', '、', ' ', '\t']);
const TONE_DICTIONARY: Record<string, Tone> = {
  春: '平', 眠: '平', 不: '仄', 觉: '仄', 晓: '仄', 处: '仄', 闻: '平', 啼: '平', 鸟: '仄',
  夜: '仄', 来: '平', 风: '平', 雨: '仄', 声: '平', 花: '平', 落: '仄', 知: '平', 多: '平', 少: '仄',
  国: '仄', 破: '仄', 山: '平', 河: '平', 在: '仄', 城: '平', 深: '平', 木: '仄', 草: '仄', 独: '仄',
  明: '平', 月: '仄', 高: '平', 天: '平', 故: '仄', 乡: '平', 万: '仄', 里: '仄', 江: '平', 船: '平',
};

const clone = <T>(value: T): T => structuredClone(value);
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

function defaultMark(): CharacterMark {
  return { tone: '?', rhyme: '', pauseAfter: false, basis: '', note: '' };
}

function candidateFromMark(mark: CharacterMark): CandidateMark {
  return { tone: mark.tone, rhyme: mark.rhyme, pauseAfter: mark.pauseAfter, basis: mark.basis, note: mark.note };
}

function initialWorkspace(): PoemWorkspace {
  const now = new Date().toISOString();
  const spring = '春眠不觉晓，\n处处闻啼鸟。\n夜来风雨声，\n花落知多少。';
  const marks: Record<string, CharacterMark> = {};
  const cells = [
    ['晓', 0, '仄', false], ['鸟', 1, '仄', false], ['声', 2, '平', false], ['少', 3, '仄', false],
  ] as const;
  cells.forEach(([char, line, tone, pause]) => {
    marks[markKey(line, 4)] = { tone, rhyme: 'A', pauseAfter: pause, basis: '《平水韵》上声十七筱', note: `${char} 为韵脚`, status: 'confirmed' };
  });
  marks[markKey(0, 2)] = { tone: '平', rhyme: '', pauseAfter: false, basis: '平水韵', note: '', status: 'confirmed' };
  marks[markKey(1, 2)] = { tone: '平', rhyme: '', pauseAfter: false, basis: '平水韵', note: '', status: 'confirmed' };
  marks[markKey(2, 2)] = { tone: '平', rhyme: '', pauseAfter: false, basis: '平水韵', note: '', status: 'confirmed' };

  const topVersion: PoemVersion = {
    id: 'version-main',
    name: '通行本 · 孟浩然集',
    source: '《孟浩然诗集笺注》',
    createdAt: now,
    text: spring,
    marks,
    antithesisPairs: [],
  };
  return {
    title: '春晓',
    author: '孟浩然',
    templateId: 'wuyan-zeqi',
    versions: [topVersion],
    activeVersionId: topVersion.id,
    updatedAt: now,
    mergeBatches: [],
  };
}

function loadWorkspace(): PoemWorkspace {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialWorkspace();
    const parsed = JSON.parse(raw) as PoemWorkspace;
    if (!parsed.versions?.length) return initialWorkspace();
    parsed.mergeBatches ??= [];
    return parsed;
  } catch {
    return initialWorkspace();
  }
}

/** 批次导入报文：版本快照只有正文，标注与对仗全部是候选 */
export interface BatchImportPayload {
  sourceName: string;
  sourceRef?: string;
  text: string;
  marks?: Record<string, CandidateMark>;
  antithesis?: Array<{ leftLine: number; rightLine: number; note: string }>;
}

@Injectable({ providedIn: 'root' })
export class PoetryStoreService {
  readonly workspace = signal<PoemWorkspace>(loadWorkspace());
  readonly selectedLine = signal(0);
  readonly selectedPosition = signal(4);
  readonly baselineVersionId = signal<string>('');
  readonly currentDiffIndex = signal(0);
  readonly toast = signal('');
  readonly undoCount = signal(0);
  readonly redoCount = signal(0);

  private readonly engine = new MergeEngine();
  private undoStack: PoemWorkspace[] = [];
  private redoStack: PoemWorkspace[] = [];

  readonly activeVersion = computed(() => {
    const state = this.workspace();
    return state.versions.find((version) => version.id === state.activeVersionId) ?? state.versions[0];
  });

  readonly template = computed(() => {
    return METER_TEMPLATES.find((item) => item.id === this.workspace().templateId) ?? METER_TEMPLATES[0];
  });

  readonly lines = computed(() => this.activeVersion().text.split('\n'));

  readonly activeBatch = computed<MergeBatch | undefined>(() => {
    const state = this.workspace();
    return state.mergeBatches?.find((batch) => batch.id === state.activeBatchId);
  });

  readonly mergePreview = computed<MergePreview | undefined>(() => {
    const batch = this.activeBatch();
    if (!batch || batch.status === 'merged') return undefined;
    return this.engine.preview(batch, this.activeVersion());
  });

  /** 当前稿全部待复核字（含来源标注） */
  readonly pendingReview = computed<PendingPosition[]>(() => {
    const version = this.activeVersion();
    const result: PendingPosition[] = [];
    version.text.split('\n').forEach((lineText, line) => {
      lineChars(lineText).forEach((char, position) => {
        const mark = version.marks[markKey(line, position)];
        if (mark?.status === 'pending') {
          result.push({ line, position, char, source: mark.originSource ?? '来源待核', candidate: mark.candidate });
        }
      });
    });
    return result.sort((a, b) => a.line - b.line || a.position - b.position);
  });

  readonly pendingCount = computed(() => this.pendingReview().length);

  /** 待复核按来源汇总：异文对照与导出使用 */
  readonly pendingBySource = computed<Array<{ source: string; count: number }>>(() => {
    const map = new Map<string, number>();
    this.pendingReview().forEach((item) => map.set(item.source, (map.get(item.source) ?? 0) + 1));
    return [...map.entries()].map(([source, count]) => ({ source, count }));
  });

  readonly analysis = computed<AnalysisLine[]>(() => {
    const version = this.activeVersion();
    const template = this.template();
    return this.lines().map((line, lineIndex) => {
      const chars = Array.from(line).filter((char) => !PUNCTUATION.has(char));
      const cells: AnalysisCell[] = chars.map((char, position) => {
        const mark = version.marks[markKey(lineIndex, position)] ?? defaultMark();
        const expected = template.pattern[lineIndex * template.lineLength + position] ?? '中';
        const actual = mark.tone === '?' ? (TONE_DICTIONARY[char] ?? '?') : mark.tone;
        let status: AnalysisCell['status'] = 'neutral';
        let message = '标点或不计律位置';
        if (PUNCTUATION.has(char)) {
          status = 'neutral';
        } else if (actual === '?') {
          status = 'unknown';
          message = '尚未标注平仄';
        } else if (expected === '中') {
          status = 'correct';
          message = '可平可仄';
        } else if (actual === expected) {
          status = 'correct';
          message = '合律';
        } else if (this.isAcceptableVariant(template, position)) {
          status = 'variant';
          message = '一三五位置的可接受变体';
        } else {
          status = 'error';
          message = `此处应为${expected}声`;
        }
        if (mark.status === 'pending') message = `待复核（来源：${mark.originSource ?? '批次'}）· ${message}`;
        return { char, position, expected, actual, status, message, mark };
      });
      const rhymeChars = template.rhymeLines.includes(lineIndex) ? cells.slice(-1).map((cell) => cell.char) : [];
      return {
        index: lineIndex,
        cells,
        rhymeChars,
        errors: cells.filter((cell) => cell.status === 'error').length,
        variants: cells.filter((cell) => cell.status === 'variant').length,
      };
    });
  });

  readonly issues = computed<PoemIssue[]>(() => {
    const analysis = this.analysis();
    const version = this.activeVersion();
    const template = this.template();
    const issues: PoemIssue[] = [];
    analysis.forEach((line) => {
      line.cells.filter((cell) => cell.status === 'error').forEach((cell) => {
        issues.push({
          id: uid('issue'),
          level: 'error',
          title: '出律位置',
          detail: `第 ${line.index + 1} 句“${cell.char}”：${cell.message}`,
          line: line.index,
          position: cell.position,
        });
      });
      if (line.cells.some((cell) => cell.status === 'unknown')) {
        issues.push({ id: uid('issue'), level: 'warning', title: '存在未标注字', detail: `第 ${line.index + 1} 句仍有平仄未确认。`, line: line.index });
      }
    });
    const pending = this.pendingReview();
    if (pending.length) {
      const summary = this.pendingBySource().map((item) => `${item.source} ${item.count} 字`).join('；');
      issues.push({
        id: 'pending-review',
        level: 'warning',
        title: `${pending.length} 字待复核`,
        detail: `合流后真正改动的字已转待复核：${summary}。`,
        line: pending[0].line,
        position: pending[0].position,
      });
    }
    const rhymeCells = template.rhymeLines.map((line) => analysis[line]?.cells.at(-1)).filter(Boolean);
    const rhymeGroups = new Map<string, string[]>();
    rhymeCells.forEach((cell) => {
      if (!cell?.mark.rhyme) {
        issues.push({ id: uid('issue'), level: 'warning', title: '韵脚缺少韵部', detail: `第 ${(cell?.position ?? 0) + 1} 句末字尚未指定韵部。` });
        return;
      }
      rhymeGroups.set(cell.mark.rhyme, [...(rhymeGroups.get(cell.mark.rhyme) ?? []), cell.char]);
    });
    rhymeGroups.forEach((chars, rhyme) => {
      const duplicate = chars.find((char, index) => chars.indexOf(char) !== index);
      if (duplicate) issues.push({ id: uid('issue'), level: 'warning', title: '重复用韵', detail: `韵部 ${rhyme} 重复使用末字“${duplicate}”。` });
    });
    if (version.antithesisPairs.length === 0) {
      issues.push({ id: 'antithesis-empty', level: 'info', title: '尚未标记对仗', detail: '可在检视器中把两句建立对仗关系。' });
    }
    if (!issues.some((issue) => issue.level === 'error')) {
      issues.unshift({ id: 'meter-ok', level: 'info', title: '格律检查通过', detail: '当前未发现硬性出律，请继续核对可接受变体。' });
    }
    return issues;
  });

  readonly diff = computed<CharDiff[]>(() => {
    const left = this.workspace().versions.find((version) => version.id === this.baselineVersionId());
    const right = this.activeVersion();
    if (!left || left.id === right.id) return [];
    const leftChars = left.text.split('\n').flatMap((lineText) => lineChars(lineText));
    const rightChars = right.text.split('\n').flatMap((lineText) => lineChars(lineText));
    // 右版本扁平字序 → 行:位置，用于挂待复核状态
    const rightKeys: string[] = [];
    right.text.split('\n').forEach((lineText, line) => {
      lineChars(lineText).forEach((_, p) => rightKeys.push(markKey(line, p)));
    });
    const size = Math.max(leftChars.length, rightChars.length);
    return Array.from({ length: size }, (_, index) => {
      const markKeyAt = rightKeys[index];
      const mark = markKeyAt ? right.marks[markKeyAt] : undefined;
      return {
        index,
        left: leftChars[index] ?? '',
        right: rightChars[index] ?? '',
        changed: leftChars[index] !== rightChars[index],
        pending: mark?.status === 'pending',
        originSource: mark?.status === 'pending' ? mark.originSource : undefined,
        candidate: mark?.status === 'pending' ? mark.candidate : undefined,
      };
    });
  });

  readonly differences = computed(() => this.diff().filter((item) => item.changed).map((item) => item.index));
  readonly baselineVersion = computed(() => this.workspace().versions.find((version) => version.id === this.baselineVersionId()));

  selectVersion(id: string): void {
    this.workspace.update((workspace) => ({ ...workspace, activeVersionId: id, activeBatchId: undefined }));
  }

  selectCell(line: number, position: number): void {
    this.selectedLine.set(line);
    this.selectedPosition.set(position);
  }

  setTemplate(id: string): void {
    this.commit((workspace) => {
      workspace.templateId = id;
    });
  }

  /** 正文改动：旧位置标注按对齐结果搬迁，只有真正改过/新增的字转待复核，别处照旧 */
  updateText(text: string): void {
    this.commit((workspace) => {
      const version = this.versionIn(workspace);
      version.marks = this.remapMarks(version.text, text, version.marks);
      version.text = text;
    });
  }

  updateTitle(title: string): void {
    this.commit((workspace) => {
      workspace.title = title;
    });
  }

  updateVersionSource(source: string): void {
    this.commit((workspace) => {
      this.versionIn(workspace).source = source;
    });
  }

  setMark(patch: Partial<CharacterMark>): void {
    this.commit((workspace) => {
      const version = this.versionIn(workspace);
      const id = markKey(this.selectedLine(), this.selectedPosition());
      version.marks[id] = {
        ...defaultMark(),
        ...version.marks[id],
        ...patch,
        status: 'confirmed', // 人工显式标注即确认
      };
    });
  }

  cycleTone(): void {
    const cell = this.selectedCell();
    const next: Record<Tone, MarkTone | '?'> = { '?': '平', '平': '仄', '仄': '中', '中': '?' };
    this.setMark({ tone: next[cell?.actual ?? '?'] });
  }

  togglePause(): void {
    const cell = this.selectedCell();
    this.setMark({ pauseAfter: !(cell?.mark.pauseAfter ?? false) });
  }

  cycleRhyme(): void {
    const cell = this.selectedCell();
    const current = cell?.mark.rhyme ?? '';
    const next = current === '' ? 'A' : current === 'A' ? 'B' : current === 'B' ? 'C' : '';
    this.setMark({ rhyme: next });
  }

  /** 采用候选值并确认（候选平仄/韵组/停顿落为正式标注，依据保留） */
  adoptCandidate(): void {
    const cell = this.selectedCell();
    const candidate = cell?.mark.candidate;
    this.commit((workspace) => {
      const version = this.versionIn(workspace);
      const id = markKey(this.selectedLine(), this.selectedPosition());
      const current = version.marks[id] ?? defaultMark();
      version.marks[id] = {
        ...defaultMark(),
        ...current,
        ...(candidate ?? {}),
        status: 'confirmed',
        candidate: undefined,
        originBatchId: current.originBatchId,
        originSource: current.originSource,
      };
    });
  }

  /** 不采用候选，以当前值确认通过 */
  confirmAsIs(): void {
    this.commit((workspace) => {
      const id = markKey(this.selectedLine(), this.selectedPosition());
      const mark = this.versionIn(workspace).marks[id];
      if (mark) {
        mark.status = 'confirmed';
        mark.candidate = undefined;
      }
    });
  }

  addAntithesis(): void {
    const line = this.selectedLine();
    const other = line === 0 ? 1 : line - 1;
    this.commit((workspace) => {
      const version = this.versionIn(workspace);
      if (version.antithesisPairs.some((pair) => pair.leftLine === line && pair.rightLine === other)) return;
      version.antithesisPairs.push({ id: uid('pair'), leftLine: Math.min(line, other), rightLine: Math.max(line, other), note: '结构相对，词性相应。' });
    });
  }

  removeAntithesis(id: string): void {
    this.commit((workspace) => {
      const version = this.versionIn(workspace);
      version.antithesisPairs = version.antithesisPairs.filter((pair) => pair.id !== id);
    });
  }

  updateAntithesis(id: string, note: string): void {
    this.commit((workspace) => {
      const pair = this.versionIn(workspace).antithesisPairs.find((item) => item.id === id);
      if (pair) pair.note = note;
    });
  }

  snapshot(): void {
    const active = clone(this.activeVersion());
    active.id = uid('version');
    active.name = `校勘稿 ${this.workspace().versions.length}`;
    active.createdAt = new Date().toISOString();
    this.commit((workspace) => {
      workspace.versions.unshift(active);
      workspace.activeVersionId = active.id;
      workspace.activeBatchId = undefined;
    });
    this.toast.set('已建立独立校勘稿');
  }

  duplicateActiveAsBaseline(): void {
    this.baselineVersionId.set(this.activeVersion().id);
  }

  nextDifference(): void {
    const values = this.differences();
    if (!values.length) return;
    const current = values.findIndex((index) => index >= this.currentDiffIndex());
    this.currentDiffIndex.set(values[(current + 1) % values.length]);
  }

  previousDifference(): void {
    const values = this.differences();
    if (!values.length) return;
    const reverse = [...values].reverse();
    const current = reverse.findIndex((index) => index <= this.currentDiffIndex());
    this.currentDiffIndex.set(reverse[(current + 1) % reverse.length]);
  }

  // ---------- 宋刻本批次合流 ----------

  /** 导入批次：快照只取来源正文与当前稿正文，标注、对仗全部作候选 */
  importBatch(payload: BatchImportPayload): { ok: boolean; error?: string } {
    const sourceLines = payload.text.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
    if (!sourceLines.length) return { ok: false, error: '来源正文为空' };
    const version = this.activeVersion();
    const sourceMarks: Record<string, CandidateMark> = {};
    Object.entries(payload.marks ?? {}).forEach(([k, value]) => {
      sourceMarks[k] = { tone: value.tone ?? '?', rhyme: value.rhyme ?? '', pauseAfter: !!value.pauseAfter, basis: value.basis ?? '', note: value.note ?? '' };
    });
    const batch: MergeBatch = {
      id: uid('batch'),
      sourceName: payload.sourceName,
      sourceRef: payload.sourceRef ?? '',
      targetVersionId: version.id,
      createdAt: new Date().toISOString(),
      status: 'open',
      sourceLines,
      draftSnapshot: version.text.split('\n'),
      sourceMarks,
      antithesisSuggestions: (payload.antithesis ?? []).map((item) => ({
        id: uid('sug'),
        leftLine: item.leftLine,
        rightLine: item.rightLine,
        note: item.note,
      })),
      conflictChoices: {},
    };
    this.commit((workspace) => {
      workspace.mergeBatches ??= [];
      workspace.mergeBatches.push(batch);
      workspace.activeBatchId = batch.id;
    });
    this.toast.set(`已导入「${payload.sourceName}」批次：标注与对仗均为候选，请先处理两边同改句`);
    return { ok: true };
  }

  selectBatch(id: string): void {
    this.workspace.update((workspace) => ({ ...workspace, activeBatchId: id }));
  }

  /** 两边改过同一句：并列保留，记录选定来源；选定前不覆盖当前稿 */
  chooseConflict(rowKey: string, choice: 'source' | 'draft' | undefined): void {
    this.commit((workspace) => {
      const batch = workspace.mergeBatches?.find((item) => item.id === workspace.activeBatchId);
      if (!batch) return;
      batch.conflictChoices ??= {};
      if (choice === undefined) delete batch.conflictChoices[rowKey];
      else batch.conflictChoices[rowKey] = choice;
      // 失败状态保持到下次重试成功为止，批次与选择都保留
    });
  }

  setSuggestionDecision(suggestionId: string, decision: 'accept' | 'reject' | undefined): void {
    this.commit((workspace) => {
      const batch = workspace.mergeBatches?.find((item) => item.id === workspace.activeBatchId);
      const suggestion = batch?.antithesisSuggestions.find((item) => item.id === suggestionId);
      if (suggestion) suggestion.decision = decision;
    });
  }

  /** 执行合流：失败保留批次和已确认选择，重试沿用同一批次不重复生成 */
  commitMerge(): void {
    const batch = this.activeBatch();
    const preview = this.mergePreview();
    if (!batch || !preview) return;
    const version = this.activeVersion();
    const result = this.engine.apply(batch, preview, version);
    if (!result.ok || !result.text) {
      this.commit((workspace) => {
        const target = workspace.mergeBatches?.find((item) => item.id === batch.id);
        if (target) {
          target.status = 'failed';
          target.lastError = result.error;
        }
      });
      this.toast.set(result.error ?? '合流失败，批次与已确认选择已保留，可重试');
      return;
    }
    this.commit((workspace) => {
      const target = workspace.versions.find((item) => item.id === version.id)!;
      target.text = result.text!;
      target.marks = result.marks!;
      target.antithesisPairs = result.antithesisPairs!;
      const b = workspace.mergeBatches?.find((item) => item.id === batch.id);
      if (b) {
        b.status = 'merged';
        b.mergedAt = new Date().toISOString();
        b.lastError = undefined;
      }
      workspace.activeBatchId = undefined;
    });
    this.toast.set(`合流完成：${result.pendingPositions?.length ?? 0} 个真正改动的字已转待复核，别处照旧`);
  }

  undo(): void {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(clone(this.workspace()));
    this.workspace.set(previous);
    this.undoCount.set(this.undoStack.length);
    this.redoCount.set(this.redoStack.length);
    this.persist();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(clone(this.workspace()));
    this.workspace.set(next);
    this.undoCount.set(this.undoStack.length);
    this.redoCount.set(this.redoStack.length);
    this.persist();
  }

  exportProofreadCopy(): string {
    const active = this.activeVersion();
    const lines = this.analysis().map((line) => {
      const tags = line.cells.map((cell) => {
        const base = `${cell.char}${cell.actual === '?' ? '□' : `(${cell.actual})`}`;
        return cell.mark.status === 'pending' ? `${base}〔待复核·${cell.mark.originSource ?? '来源'}〕` : base;
      }).join(' ');
      return `第 ${line.index + 1} 句：${tags}`;
    });
    const notes = this.issues().map((issue) => `[${issue.level.toUpperCase()}] ${issue.title}：${issue.detail}`);
    const pending = this.pendingReview();
    const pendingSection = pending.length
      ? [
          '## 待复核异文',
          `共 ${pending.length} 字待复核；来源：${this.pendingBySource().map((item) => `${item.source}（${item.count}）`).join('、')}`,
          ...pending.map((item) => `- 第 ${item.line + 1} 句第 ${item.position + 1} 字“${item.char}”，来源：${item.source}${item.candidate?.tone && item.candidate.tone !== '?' ? `，候选平仄：${item.candidate.tone}` : ''}`),
        ]
      : ['## 待复核异文', '无待复核字。'];
    return [
      `# ${this.workspace().title} · 格律校对稿`,
      '',
      `底本：${active.name}`,
      `出处：${active.source}`,
      '',
      '## 字音标注',
      ...lines,
      '',
      ...pendingSection,
      '',
      '## 检查记录',
      ...notes,
    ].join('\n');
  }

  downloadProofreadCopy(): void {
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(new Blob([this.exportProofreadCopy()], { type: 'text/markdown;charset=utf-8' }));
    anchor.download = `${this.workspace().title}-格律校对稿.md`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }

  selectedCell(): AnalysisCell | undefined {
    return this.analysis()[this.selectedLine()]?.cells[this.selectedPosition()];
  }

  /** 旧正文 → 新正文：行、字两级三向对齐搬迁标注；改动/新增字转待复核并保留旧标注为候选 */
  private remapMarks(oldText: string, newText: string, oldMarks: Record<string, CharacterMark>): Record<string, CharacterMark> {
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');
    const rows = threeWayAlign(oldLines, oldLines, newLines);
    const next: Record<string, CharacterMark> = {};
    rows.forEach((row) => {
      if (row.draft === null) return; // 删除行：旧标注丢弃
      const outLine = row.draft;
      if (row.base === null) {
        // 新增行：全部转待复核
        lineChars(newLines[outLine]).forEach((_, p) => {
          next[markKey(outLine, p)] = { ...defaultMark(), status: 'pending', originSource: '正文新增' };
        });
        return;
      }
      const oldChars = lineChars(oldLines[row.base]);
      const newChars = lineChars(newLines[outLine]);
      // 行内以旧行同时为“基”和“来源”、新行为“当前稿”做三向对齐
      const triples = alignThreeChars(oldChars, oldChars, newChars);
      triples.forEach(([bIdx, , dIdx]) => {
        if (dIdx === null) return;
        const oldChar = bIdx !== null ? oldChars[bIdx] : '';
        const newChar = newChars[dIdx];
        const oldMark = bIdx !== null ? oldMarks[markKey(row.base!, bIdx)] : undefined;
        if (bIdx !== null && oldChar === newChar) {
          // 同位未改字：照旧（含其待复核/已确认状态与候选）
          if (oldMark) next[markKey(outLine, dIdx)] = { ...oldMark, candidate: oldMark.candidate ? { ...oldMark.candidate } : undefined };
        } else {
          // 真正改了的字或新增字：旧位置标注失效，转待复核，原值留作候选
          next[markKey(outLine, dIdx)] = {
            ...defaultMark(),
            status: 'pending',
            originSource: '正文改动',
            candidate: oldMark ? candidateFromMark(oldMark) : undefined,
          };
        }
      });
    });
    return next;
  }

  private commit(mutator: (workspace: PoemWorkspace) => void): void {
    this.undoStack.push(clone(this.workspace()));
    if (this.undoStack.length > 80) this.undoStack.shift();
    this.redoStack = [];
    const next = clone(this.workspace());
    mutator(next);
    next.updatedAt = new Date().toISOString();
    this.workspace.set(next);
    this.undoCount.set(this.undoStack.length);
    this.redoCount.set(0);
    this.persist();
  }

  private versionIn(workspace: PoemWorkspace): PoemVersion {
    return workspace.versions.find((item) => item.id === workspace.activeVersionId) ?? workspace.versions[0];
  }

  private persist(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.workspace()));
  }

  private isAcceptableVariant(template: MeterTemplate, position: number): boolean {
    if (template.lineLength === 5) return position === 0 || position === 2;
    return position === 0 || position === 2 || position === 4;
  }
}

import { computed, Injectable, signal } from '@angular/core';
import type {
  AntithesisPair,
  AnalysisCell,
  AnalysisLine,
  CharacterMark,
  CharDiff,
  CollationBatch,
  MarkTone,
  MergeCandidate,
  MergeItem,
  MergeSession,
  MeterTemplate,
  PoemIssue,
  PoemVersion,
  PoemWorkspace,
  Tone,
} from '../models/poem.models';

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

const STORAGE_KEY = 'sologsb-1015-poetry-workspace-v1';
const PUNCTUATION = new Set(['，', '。', '！', '？', '；', '：', '、', ' ', '\t']);
const TONE_DICTIONARY: Record<string, Tone> = {
  春: '平', 眠: '平', 不: '仄', 觉: '仄', 晓: '仄', 处: '仄', 闻: '平', 啼: '平', 鸟: '仄',
  夜: '仄', 来: '平', 风: '平', 雨: '仄', 声: '平', 花: '平', 落: '仄', 知: '平', 多: '平', 少: '仄',
  国: '仄', 破: '仄', 山: '平', 河: '平', 在: '仄', 城: '平', 深: '平', 木: '仄', 草: '仄', 独: '仄',
  明: '平', 月: '仄', 高: '平', 天: '平', 故: '仄', 乡: '平', 万: '仄', 里: '仄', 江: '平', 船: '平',
};

const clone = <T>(value: T): T => structuredClone(value);
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

function key(line: number, position: number): string {
  return `${line}:${position}`;
}

function defaultMark(): CharacterMark {
  return { tone: '?', rhyme: '', pauseAfter: false, basis: '', note: '' };
}

/** 拆出诗句中的汉字与随字标点（标点附在前一个汉字之后） */
export function splitLine(raw: string): { chars: string[]; punct: string[] } {
  const chars: string[] = [];
  const punct: string[] = [];
  for (const char of Array.from(raw)) {
    if (PUNCTUATION.has(char)) {
      if (chars.length) punct[chars.length - 1] += char;
      continue;
    }
    chars.push(char);
    punct.push('');
  }
  return { chars, punct };
}

export function stripPunct(raw: string): string {
  return Array.from(raw).filter((char) => !PUNCTUATION.has(char)).join('');
}

type AlignOp =
  | { type: 'equal'; from: number; to: number }
  | { type: 'replace'; from: number; fromLen: number; to: number; toLen: number }
  | { type: 'insert'; to: number; toLen: number }
  | { type: 'delete'; from: number; fromLen: number };

/** 行级 LCS：用于正文改字后重算标注位置与并列对照 */
export function alignChars(a: string[], b: string[]): AlignOp[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  type RawOp = { type: 'equal' | 'delete' | 'insert'; ai: number; bj: number };
  const raw: RawOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      raw.push({ type: 'equal', ai: i, bj: j });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      raw.push({ type: 'delete', ai: i, bj: j });
      i++;
    } else {
      raw.push({ type: 'insert', ai: i, bj: j });
      j++;
    }
  }
  while (i < n) raw.push({ type: 'delete', ai: i++, bj: m });
  while (j < m) raw.push({ type: 'insert', ai: n, bj: j++ });

  const ops: AlignOp[] = [];
  for (let k = 0; k < raw.length; k++) {
    const op = raw[k];
    if (op.type === 'equal') {
      ops.push({ type: 'equal', from: op.ai, to: op.bj });
    } else if (op.type === 'delete' && raw[k + 1]?.type === 'insert') {
      const next = raw[k + 1];
      ops.push({ type: 'replace', from: op.ai, fromLen: 1, to: next.bj, toLen: 1 });
      k++;
    } else if (op.type === 'insert' && raw[k + 1]?.type === 'delete') {
      const next = raw[k + 1];
      ops.push({ type: 'replace', from: next.ai, fromLen: 1, to: op.bj, toLen: 1 });
      k++;
    } else if (op.type === 'delete') {
      ops.push({ type: 'delete', from: op.ai, fromLen: 1 });
    } else {
      ops.push({ type: 'insert', to: op.bj, toLen: 1 });
    }
  }
  return ops;
}

function initialWorkspace(): PoemWorkspace {
  const now = new Date().toISOString();
  const spring = '春眠不觉晓，\n处处闻啼鸟。\n夜来风雨声，\n花落知多少。';
  const marks: Record<string, CharacterMark> = {};
  const cells = [
    ['晓', 0, '平', false], ['鸟', 1, '平', false], ['声', 2, '平', false], ['少', 3, '平', false],
  ] as const;
  cells.forEach(([char, line, tone, pause]) => {
    marks[key(line, 4)] = { tone, rhyme: 'A', pauseAfter: pause, basis: '《平水韵》上声十七筱', note: `${char} 为韵脚` };
  });
  marks[key(0, 2)] = { tone: '平', rhyme: '', pauseAfter: false, basis: '平水韵', note: '句中平声' };
  marks[key(1, 2)] = { tone: '平', rhyme: '', pauseAfter: false, basis: '平水韵', note: '' };
  marks[key(2, 2)] = { tone: '平', rhyme: '', pauseAfter: false, basis: '平水韵', note: '' };

  const variants = spring.replace('处处闻啼鸟', '处处闻啼鸟');
  const topVersion: PoemVersion = {
    id: 'version-main',
    name: '通行本 · 孟浩然集',
    source: '《孟浩然诗集笺注》',
    createdAt: now,
    text: variants,
    marks,
    antithesisPairs: [],
  };
  const variant: PoemVersion = {
    id: 'version-song',
    name: '宋刻本异文',
    source: '宋蜀刻本',
    createdAt: now,
    text: '春眠不觉晓，\n处处闻啼鸟。\n夜来风雨声，\n花落知多少。',
    marks: clone(marks),
    antithesisPairs: [],
  };
  return {
    title: '春晓',
    author: '孟浩然',
    templateId: 'wuyan-zeqi',
    versions: [topVersion, variant],
    activeVersionId: topVersion.id,
    mergeSessions: [],
    updatedAt: now,
  };
}

function loadWorkspace(): PoemWorkspace {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialWorkspace();
    const parsed = JSON.parse(raw) as PoemWorkspace;
    if (!parsed.versions?.length) return initialWorkspace();
    return { ...parsed, mergeSessions: parsed.mergeSessions ?? [] };
  } catch {
    return initialWorkspace();
  }
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

  /** 进行中的合流会话（不进 undo 栈，失败重试期间保持） */
  readonly activeMergeSessionId = signal<string>('');
  readonly mergeError = signal('');

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

  readonly analysis = computed<AnalysisLine[]>(() => {
    const version = this.activeVersion();
    const template = this.template();
    return this.lines().map((line, lineIndex) => {
      const chars = Array.from(line).filter((char) => !PUNCTUATION.has(char));
      const cells: AnalysisCell[] = chars.map((char, position) => {
        const mark = version.marks[key(lineIndex, position)] ?? defaultMark();
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
        } else if (this.isAcceptableVariant(template, lineIndex, position)) {
          status = 'variant';
          message = '一三五位置的可接受变体';
        } else {
          status = 'error';
          message = `此处应为${expected}声`;
        }
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
    const pending = this.pendingReviewCount();
    if (pending.count > 0) {
      issues.push({
        id: 'pending-review',
        level: 'warning',
        title: '合流待复核',
        detail: `${pending.count} 字因正文改动或候选标注待人工确认，来源：${pending.sources.join('、')}。`,
      });
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
    const leftChars = Array.from(left.text.replace(/\n/g, ''));
    const rightChars = Array.from(right.text.replace(/\n/g, ''));
    const size = Math.max(leftChars.length, rightChars.length);
    return Array.from({ length: size }, (_, index) => ({
      index,
      left: leftChars[index] ?? '',
      right: rightChars[index] ?? '',
      changed: leftChars[index] !== rightChars[index],
    }));
  });

  readonly differences = computed(() => this.diff().filter((item) => item.changed).map((item) => item.index));
  readonly baselineVersion = computed(() => this.workspace().versions.find((version) => version.id === this.baselineVersionId()));

  readonly activeMergeSession = computed(
    () => this.workspace().mergeSessions.find((session) => session.id === this.activeMergeSessionId() && session.status === 'pending'),
  );

  readonly pendingReviewCount = computed(() => {
    let count = 0;
    const sources = new Set<string>();
    for (const mark of Object.values(this.activeVersion().marks)) {
      if (mark.pendingReview) {
        count++;
        if (mark.reviewSource) sources.add(mark.reviewSource);
      }
    }
    return { count, sources: [...sources] };
  });

  /** 全局字位（含标点、不含换行）→ 是否待复核，供异文对照标签对齐 */
  readonly pendingFlatMap = computed<Set<number>>(() => {
    const flat = new Set<number>();
    const marks = this.activeVersion().marks;
    let cursor = 0;
    this.lines().forEach((raw, lineIndex) => {
      let hanPosition = 0;
      for (const char of Array.from(raw)) {
        if (PUNCTUATION.has(char)) {
          cursor++;
          continue;
        }
        if (marks[key(lineIndex, hanPosition)]?.pendingReview) flat.add(cursor);
        hanPosition++;
        cursor++;
      }
    });
    return flat;
  });

  selectVersion(id: string): void {
    this.workspace.update((workspace) => ({ ...workspace, activeVersionId: id }));
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

  updateText(text: string): void {
    this.commit((workspace) => {
      const version = this.versionIn(workspace);
      const oldLines = version.text.split('\n');
      const newLines = text.split('\n');
      const remapped: Record<string, CharacterMark> = {};
      const lineCount = Math.max(oldLines.length, newLines.length);
      for (let line = 0; line < lineCount; line++) {
        const oldSplit = splitLine(oldLines[line] ?? '');
        const newSplit = splitLine(newLines[line] ?? '');
        for (const op of alignChars(oldSplit.chars, newSplit.chars)) {
          if (op.type === 'equal') {
            const old = version.marks[key(line, op.from)];
            if (old) remapped[key(line, op.to)] = old;
          } else if (op.type === 'replace') {
            // 真改过的字：旧位置标注失效；新字先留空待标并转待复核，别处照旧
            for (let p = 0; p < op.toLen; p++) {
              remapped[key(line, op.to + p)] = {
                ...defaultMark(),
                pendingReview: true,
                reviewSource: '正文改字重算',
              };
            }
          } else if (op.type === 'insert') {
            for (let p = 0; p < op.toLen; p++) {
              remapped[key(line, op.to + p)] = {
                ...defaultMark(),
                pendingReview: true,
                reviewSource: '正文新增字',
              };
            }
          }
          // delete：旧标注随字删除而失效丢弃
        }
      }
      version.text = text;
      version.marks = remapped;
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
      const id = key(this.selectedLine(), this.selectedPosition());
      version.marks[id] = { ...defaultMark(), ...version.marks[id], ...patch };
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

  // ===== 宋刻本批次合流 =====

  private batchIdentity(batch: CollationBatch): string {
    if (batch.batchId) return batch.batchId;
    const body = `${batch.source}|${(batch.lines ?? []).join('/') ?? batch.text ?? ''}`;
    let hash = 0;
    for (const ch of body) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
    return `batch-${(hash >>> 0).toString(36)}`;
  }

  /** 直接改写工作区并持久化，不进撤销栈（用于合流的中间态：建会话、复核选择、重试） */
  private lightweightUpdate(mutator: (workspace: PoemWorkspace) => void): void {
    this.workspace.update((workspace) => {
      const next = clone(workspace);
      mutator(next);
      return next;
    });
    this.persist();
  }

  /**
   * 合入校勘员批次：
   * - 解析/校验失败不提交任何变更，保留批次文本与已确认选择，便于重试；
   * - 同一批次重试复用已有会话与版本快照，不重复生成版本；
   * - 平仄、韵组、停顿、对仗只入候选清单，选定来源前不覆盖当前稿；
   * - 建会话/快照属合流中间态，不入撤销栈；应用时整体作为一步可撤销。
   */
  startMerge(rawInput: string): boolean {
    this.mergeError.set('');
    let batch: CollationBatch;
    try {
      batch = JSON.parse(rawInput) as CollationBatch;
    } catch {
      this.mergeError.set('批次 JSON 无法解析，请核对格式后重试。');
      return false;
    }
    const validation = this.validateBatch(batch);
    if (validation) {
      this.mergeError.set(validation);
      return false;
    }

    const sourceText = batch.lines ? batch.lines.join('\n') : (batch.text as string);
    const identity = this.batchIdentity(batch);
    const existing = this.workspace().mergeSessions.find(
      (session) => session.batchId === identity && session.status === 'pending',
    );
    if (existing) {
      // 重试：版本快照与已确认选择原样保留，仅按最新批次重建候选
      this.lightweightUpdate((workspace) => {
        const session = workspace.mergeSessions.find((item) => item.id === existing.id);
        if (session) {
          session.items = this.buildMergeItems(workspace, session.targetVersionId, session.snapshotVersionId, batch, session.items);
          session.source = batch.source;
          session.label = batch.name ?? session.label;
        }
      });
      this.activeMergeSessionId.set(existing.id);
      this.toast.set('已按最新批次重试合流，版本快照与已确认选择保留');
      return true;
    }

    const now = new Date().toISOString();
    const snapshot: PoemVersion = {
      id: uid('version-song'),
      name: batch.name ? `${batch.name}` : `宋刻本来源 · ${batch.source}`,
      source: batch.source,
      createdAt: now,
      text: sourceText,
      marks: {},
      antithesisPairs: [],
    };
    const session: MergeSession = {
      id: uid('merge'),
      batchId: identity,
      source: batch.source,
      label: snapshot.name,
      targetVersionId: this.workspace().activeVersionId,
      snapshotVersionId: snapshot.id,
      status: 'pending',
      items: [],
      createdAt: now,
    };
    this.lightweightUpdate((workspace) => {
      workspace.versions.push(snapshot);
      session.items = this.buildMergeItems(workspace, session.targetVersionId, snapshot.id, batch, []);
      workspace.mergeSessions.push(session);
    });
    this.activeMergeSessionId.set(session.id);
    this.toast.set('批次已建立合流会话，候选标注等待复核');
    return true;
  }

  private validateBatch(batch: CollationBatch): string {
    if (!batch || typeof batch !== 'object') return '批次内容为空。';
    if (!batch.source || typeof batch.source !== 'string') return '批次缺少来源说明（source）。';
    const hasLines = Array.isArray(batch.lines) && batch.lines.length > 0;
    const hasText = typeof batch.text === 'string' && batch.text.trim().length > 0;
    if (!hasLines && !hasText) return '批次缺少正文（lines 或 text）。';
    if (batch.marks && !Array.isArray(batch.marks)) return '批次的逐字标注（marks）必须是数组。';
    if (batch.antithesis && !Array.isArray(batch.antithesis)) return '批次的对仗（antithesis）必须是数组。';
    const lineCount = hasLines ? (batch.lines as string[]).length : (batch.text as string).split('\n').length;
    for (const mark of batch.marks ?? []) {
      if (typeof mark.line !== 'number' || typeof mark.position !== 'number') return '存在缺少 line/position 的逐字标注。';
      if (mark.line < 0 || mark.line >= lineCount) return `第 ${mark.line + 1} 条标注超出正文句数。`;
      const lineText = hasLines ? (batch.lines as string[])[mark.line] : (batch.text as string).split('\n')[mark.line];
      if (mark.position >= stripPunct(lineText).length) return `第 ${mark.line + 1} 句第 ${mark.position + 1} 字标注超出句长。`;
    }
    for (const pair of batch.antithesis ?? []) {
      if (typeof pair.leftLine !== 'number' || typeof pair.rightLine !== 'number') return '存在缺少句号的对仗候选。';
      if (pair.leftLine < 0 || pair.rightLine < 0 || pair.leftLine >= lineCount || pair.rightLine >= lineCount) {
        return '存在超出句数范围的对仗候选。';
      }
    }
    return '';
  }

  private buildMergeItems(
    workspace: PoemWorkspace,
    targetVersionId: string,
    snapshotVersionId: string,
    batch: CollationBatch,
    previous: MergeItem[],
  ): MergeItem[] {
    const target = workspace.versions.find((version) => version.id === targetVersionId) ?? workspace.versions[0];
    const snapshot = workspace.versions.find((version) => version.id === snapshotVersionId);
    if (!snapshot) return [];
    const currentLines = target.text.split('\n');
    const incomingLines = snapshot.text.split('\n');
    const items: MergeItem[] = [];
    const lineCount = Math.max(currentLines.length, incomingLines.length);

    for (let line = 0; line < lineCount; line++) {
      const cur = splitLine(currentLines[line] ?? '');
      const inc = splitLine(incomingLines[line] ?? '');
      for (const op of alignChars(cur.chars, inc.chars)) {
        if (op.type === 'equal') continue;
        const currentChars = op.type === 'insert' ? '' : cur.chars.slice(op.from, op.from + op.fromLen).join('');
        const incomingChars = op.type === 'delete' ? '' : inc.chars.slice(op.to, op.to + op.toLen).join('');
        const position = op.type === 'insert' ? op.to : op.from;
        const id = `text:${line}:${position}`;
        const old = previous.find((item) => item.id === id);
        items.push({
          id,
          kind: 'text',
          line,
          position,
          current: currentChars,
          incoming: incomingChars,
          choice: old?.choice ?? 'current',
          decided: old?.decided ?? false,
        });
      }
    }

    for (const mark of batch.marks ?? []) {
      const current = target.marks[key(mark.line, mark.position)] ?? defaultMark();
      const fields: Array<NonNullable<MergeItem['field']>> = ['tone', 'rhyme', 'pauseAfter'];
      for (const field of fields) {
        if (mark[field] === undefined) continue;
        const incomingValue = String(mark[field]);
        const currentValue = field === 'tone'
          ? current.tone
          : field === 'rhyme'
            ? current.rhyme || '（空）'
            : current.pauseAfter
              ? '是'
              : '否';
        const id = `mark:${mark.line}:${mark.position}:${field}`;
        if (String(mark[field]) === (field === 'rhyme' ? current.rhyme : String(current[field]))) continue;
        const old = previous.find((item) => item.id === id);
        items.push({
          id,
          kind: 'mark',
          line: mark.line,
          position: mark.position,
          char: mark.char ?? splitLine(incomingLines[mark.line] ?? '').chars[mark.position],
          field,
          currentValue,
          incomingValue,
          // 候选按字段隔离：选某一字段只套该字段，依据/批注随附
          candidate: { [field]: mark[field], basis: mark.basis, note: mark.note } as MergeCandidate,
          choice: old?.choice ?? 'current',
          decided: old?.decided ?? false,
        });
      }
    }

    for (const pair of batch.antithesis ?? []) {
      const leftLine = Math.min(pair.leftLine, pair.rightLine);
      const rightLine = Math.max(pair.leftLine, pair.rightLine);
      const exists = target.antithesisPairs.some(
        (item) => item.leftLine === leftLine && item.rightLine === rightLine,
      );
      if (exists) continue;
      const id = `anti:${leftLine}:${rightLine}`;
      const old = previous.find((item) => item.id === id);
      items.push({
        id,
        kind: 'antithesis',
        pair: { leftLine, rightLine, note: pair.note ?? '宋刻本候选对仗，结构相对。' },
        choice: old?.choice ?? 'current',
        decided: old?.decided ?? false,
      });
    }
    return items;
  }

  setMergeChoice(itemId: string, choice: 'current' | 'incoming'): void {
    // 合流选择属于复核过程，不进撤销栈；整个合流（含应用）作为一步可撤销
    const session = this.workspace().mergeSessions.find((item) => item.id === this.activeMergeSessionId());
    const target = session?.items.find((item) => item.id === itemId);
    if (!target) return;
    this.workspace.update((workspace) => {
      const next = clone(workspace);
      const nextSession = next.mergeSessions.find((item) => item.id === this.activeMergeSessionId());
      const nextTarget = nextSession?.items.find((item) => item.id === itemId);
      if (nextTarget) {
        nextTarget.choice = choice;
        nextTarget.decided = true;
      }
      return next;
    });
    this.persist();
  }

  setMergeChoicesForLine(line: number, choice: 'current' | 'incoming'): void {
    const session = this.workspace().mergeSessions.find((item) => item.id === this.activeMergeSessionId());
    if (!session) return;
    this.workspace.update((workspace) => {
      const next = clone(workspace);
      next.mergeSessions
        .find((item) => item.id === this.activeMergeSessionId())
        ?.items.filter((item) => item.kind === 'text' && item.line === line)
        .forEach((item) => {
          item.choice = choice;
          item.decided = true;
        });
      return next;
    });
    this.persist();
  }

  /** 应用合流：只把选了宋刻本的异文/候选写回当前稿；真改过的字转待复核。一次 commit，可整体撤销回合流前。 */
  applyMerge(): void {
    const sessionId = this.activeMergeSessionId();
    const session = this.workspace().mergeSessions.find((item) => item.id === sessionId);
    if (!session || session.status !== 'pending') return;

    // 撤销目标 = 合流前：剥掉本合流中间态产生的快照版本与会话
    const baseline = clone(this.workspace());
    baseline.versions = baseline.versions.filter((version) => version.id !== session.snapshotVersionId);
    baseline.mergeSessions = baseline.mergeSessions.filter((item) => item.id !== sessionId);
    baseline.updatedAt = new Date().toISOString();
    this.undoStack.push(baseline);
    if (this.undoStack.length > 80) this.undoStack.shift();
    this.redoStack = [];

    const next = clone(this.workspace());
    this.applyMergeInto(next, sessionId);
    next.updatedAt = new Date().toISOString();
    this.workspace.set(next);
    this.undoCount.set(this.undoStack.length);
    this.redoCount.set(0);
    this.activeMergeSessionId.set('');
    this.persist();
    this.toast.set('合流已应用，改动字均转待复核；可撤销回到合流前');
  }

  private applyMergeInto(workspace: PoemWorkspace, sessionId: string): void {
      const session = workspace.mergeSessions.find((item) => item.id === sessionId);
      if (!session || session.status !== 'pending') return;
      const version = workspace.versions.find((item) => item.id === session.targetVersionId) ?? workspace.versions[0];
      const snapshot = workspace.versions.find((item) => item.id === session.snapshotVersionId);
      const currentLines = version.text.split('\n');
      const incomingLines = snapshot ? snapshot.text.split('\n') : [];
      const lineCount = Math.max(currentLines.length, incomingLines.length);
      const outLines: string[] = [];
      const nextMarks: Record<string, CharacterMark> = {};
      // 批次标注按宋刻本（incoming）坐标给；正文选定后记录 incoming 位置 → 输出位置
      const incomingToOut = new Map<string, number>();

      for (let line = 0; line < lineCount; line++) {
        const cur = splitLine(currentLines[line] ?? '');
        const inc = splitLine(incomingLines[line] ?? '');
        const outChars: string[] = [];
        const outPunct: string[] = [];
        for (const op of alignChars(cur.chars, inc.chars)) {
          if (op.type === 'equal') {
            const oldMark = version.marks[key(line, op.from)];
            const newPos = outChars.length;
            if (oldMark) nextMarks[key(line, newPos)] = oldMark;
            incomingToOut.set(key(line, op.to), newPos);
            outChars.push(cur.chars[op.from]);
            outPunct.push(cur.punct[op.from] ?? inc.punct[op.to] ?? '');
          } else {
            const opFrom = 'from' in op ? op.from : 0;
            const opFromLen = 'fromLen' in op ? op.fromLen : 0;
            const opTo = 'to' in op ? op.to : 0;
            const opToLen = 'toLen' in op ? op.toLen : 0;
            const textItem = session.items.find(
              (item) => item.kind === 'text' && item.line === line && item.position === (op.type === 'insert' ? opTo : opFrom),
            );
            const takeIncoming = textItem?.choice === 'incoming';
            const chosenChars = takeIncoming
              ? inc.chars.slice(opTo, opTo + opToLen)
              : cur.chars.slice(opFrom, opFrom + opFromLen);
            chosenChars.forEach((char, p) => {
              const newPos = outChars.length;
              outChars.push(char);
              outPunct.push(takeIncoming ? (inc.punct[opTo + p] ?? cur.punct[opFrom] ?? '') : (cur.punct[opFrom + p] ?? ''));
              if (takeIncoming) {
                // 选定宋刻本：正文真改，旧位置标注失效；新字先留空待标并转待复核，
                // 具体平仄/韵组/停顿由下方“候选标注”按字段写入，未选字段不覆盖。
                incomingToOut.set(key(line, opTo + p), newPos);
                nextMarks[key(line, newPos)] = {
                  ...defaultMark(),
                  pendingReview: true,
                  reviewSource: session.source,
                };
              } else if (op.type !== 'insert') {
                // 保留当前稿：字未真改，旧位置标注照旧；delete 分支无新字不挂标
                const oldMark = version.marks[key(line, opFrom + Math.min(p, opFromLen - 1))];
                if (oldMark) nextMarks[key(line, newPos)] = oldMark;
              }
            });
          }
        }
        outLines.push(outChars.map((char, p) => char + (outPunct[p] ?? '')).join(''));
      }

      version.text = outLines.join('\n');
      version.marks = nextMarks;

      // 候选标注：仅采用选了宋刻本、且该字确在新正文中的；经坐标重映射后仍挂待复核
      for (const item of session.items) {
        if (item.kind !== 'mark' || item.choice !== 'incoming' || item.line === undefined || item.position === undefined) continue;
        const mapped = incomingToOut.get(key(item.line, item.position));
        if (mapped === undefined) continue;
        const markKey = key(item.line, mapped);
        const merged = { ...defaultMark(), ...version.marks[markKey], ...item.candidate };
        merged.pendingReview = true;
        merged.reviewSource = session.source;
        version.marks[markKey] = merged;
      }

      // 候选对仗：采用的写入当前稿
      for (const item of session.items) {
        if (item.kind !== 'antithesis' || item.choice !== 'incoming' || !item.pair) continue;
        if (version.antithesisPairs.some((pair) => pair.leftLine === item.pair!.leftLine && pair.rightLine === item.pair!.rightLine)) continue;
        version.antithesisPairs.push({ id: uid('pair'), leftLine: item.pair.leftLine, rightLine: item.pair.rightLine, note: item.pair.note });
      }

      session.status = 'applied';
      session.appliedAt = new Date().toISOString();
      workspace.activeVersionId = version.id;
  }

  /** 放弃合流：直接移除中间态会话与版本快照（本就未进撤销栈），回到合流前 */
  cancelMerge(): void {
    const sessionId = this.activeMergeSessionId();
    const session = this.workspace().mergeSessions.find((item) => item.id === sessionId);
    if (!session) return;
    this.lightweightUpdate((workspace) => {
      workspace.mergeSessions = workspace.mergeSessions.filter((item) => item.id !== sessionId);
      workspace.versions = workspace.versions.filter((version) => version.id !== session.snapshotVersionId);
    });
    this.activeMergeSessionId.set('');
    this.mergeError.set('');
    this.toast.set('已放弃本次合流，回到合流前状态');
  }

  selectMergeSession(id: string): void {
    const session = this.workspace().mergeSessions.find((item) => item.id === id && item.status === 'pending');
    if (session) {
      this.activeMergeSessionId.set(id);
      this.workspace.update((workspace) => ({ ...workspace, activeVersionId: session.targetVersionId }));
    }
  }

  clearReview(line: number, position: number): void {
    this.commit((workspace) => {
      const mark = this.versionIn(workspace).marks[key(line, position)];
      if (mark) {
        delete mark.pendingReview;
        delete mark.reviewSource;
      }
    });
  }

  clearAllReviews(): void {
    this.commit((workspace) => {
      for (const mark of Object.values(this.versionIn(workspace).marks)) {
        delete mark.pendingReview;
        delete mark.reviewSource;
      }
    });
    this.toast.set('待复核标记已全部确认');
  }

  snapshot(): void {
    const active = clone(this.activeVersion());
    active.id = uid('version');
    active.name = `校勘稿 ${this.workspace().versions.length}`;
    active.createdAt = new Date().toISOString();
    this.commit((workspace) => {
      workspace.versions.unshift(active);
      workspace.activeVersionId = active.id;
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

  undo(): void {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(clone(this.workspace()));
    this.workspace.set(previous);
    this.reconcileMergeSession();
    this.undoCount.set(this.undoStack.length);
    this.redoCount.set(this.redoStack.length);
    this.persist();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(clone(this.workspace()));
    this.workspace.set(next);
    this.reconcileMergeSession();
    this.undoCount.set(this.undoStack.length);
    this.redoCount.set(this.redoStack.length);
    this.persist();
  }

  /** 撤销/重做后，若当前激活的合流会话已不存在或已应用，则清空面板激活态 */
  private reconcileMergeSession(): void {
    const id = this.activeMergeSessionId();
    if (!id) return;
    const session = this.workspace().mergeSessions.find((item) => item.id === id);
    if (!session || session.status !== 'pending') this.activeMergeSessionId.set('');
  }

  exportProofreadCopy(): string {
    const active = this.activeVersion();
    const workspace = this.workspace();
    const lines = this.analysis().map((line) => {
      const tags = line.cells.map((cell) => `${cell.char}${cell.actual === '?' ? '□' : `(${cell.actual})`}`).join(' ');
      return `第 ${line.index + 1} 句：${tags}`;
    });
    const notes = this.issues().map((issue) => `[${issue.level.toUpperCase()}] ${issue.title}：${issue.detail}`);
    const pendingEntries: string[] = [];
    this.analysis().forEach((line) => {
      line.cells.forEach((cell) => {
        if (cell.mark.pendingReview) {
          pendingEntries.push(
            `- 第 ${line.index + 1} 句第 ${cell.position + 1} 字“${cell.char}”待复核（来源：${cell.mark.reviewSource ?? '未注明'}）`,
          );
        }
      });
    });
    const appliedSessions = workspace.mergeSessions.filter((session) => session.status === 'applied' && session.targetVersionId === active.id);
    const provenance = appliedSessions.length
      ? ['', '## 合流来源', ...appliedSessions.map((session) => `- ${session.label}（${session.source}），应用于 ${session.appliedAt ?? session.createdAt}`)]
      : [];
    return [
      `# ${workspace.title} · 格律校对稿`,
      '',
      `底本：${active.name}`,
      `出处：${active.source}`,
      `待复核：${pendingEntries.length} 字${pendingEntries.length ? `（来源：${[...new Set(this.pendingReviewCount().sources)].join('、')}）` : ''}`,
      '',
      '## 字音标注',
      ...lines,
      '',
      '## 检查记录',
      ...notes,
      ...(pendingEntries.length ? ['', '## 待复核清单', ...pendingEntries] : []),
      ...provenance,
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
    const version = workspace.versions.find((item) => item.id === workspace.activeVersionId) ?? workspace.versions[0];
    return version;
  }

  private persist(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.workspace()));
  }

  private isAcceptableVariant(template: MeterTemplate, line: number, position: number): boolean {
    if (template.lineLength === 5) return position === 0 || position === 2;
    return position === 0 || position === 2 || position === 4;
  }
}

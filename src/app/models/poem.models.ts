export type Tone = '平' | '仄' | '中' | '?';
export type MarkTone = '平' | '仄' | '中';

/** 标注来源：人工确认 / 合流批次候选 */
export type MarkOrigin = 'manual' | 'batch';

/** 待复核状态：仅来源带入或重算后失配的字需要复核 */
export type ReviewStatus = 'confirmed' | 'pending';

export interface CharacterMark {
  tone: MarkTone | '?';
  rhyme: string;
  pauseAfter: boolean;
  basis: string;
  note: string;
  status?: ReviewStatus;
  /** 待复核字的候选标注（平仄、韵组、停顿等，均为建议值） */
  candidate?: CandidateMark;
  /** 候选来自哪个批次 / 来源 */
  originBatchId?: string;
  originSource?: string;
}

/** 批次逐字建议：版本快照只管正文，其余一律先作候选 */
export interface CandidateMark {
  tone: MarkTone | '?';
  rhyme: string;
  pauseAfter: boolean;
  basis: string;
  note: string;
}

export interface AntithesisSuggestion {
  id: string;
  leftLine: number;
  rightLine: number;
  note: string;
  /** 合流前逐项决定：接受才写入，拒绝则丢弃 */
  decision?: 'accept' | 'reject';
}

export type MergeCellStatus =
  | 'equal' // 正文一致：保留当前标注
  | 'source' // 仅来源改动
  | 'draft' // 仅当前稿改动
  | 'conflict' // 两边同改同句：并列保留
  | 'source-insert'
  | 'draft-insert'
  | 'insert-conflict';

export type LineMergeState = 'equal' | 'source' | 'draft' | 'conflict';
export type LineChoice = 'source' | 'draft';

export interface MergeCell {
  key: string;
  status: MergeCellStatus;
  sourceChar: string;
  draftChar: string;
  baseChar: string;
  /** 冲突并列异文 */
  conflict: boolean;
  candidate?: CandidateMark;
  /** 三方行号 / 行内字序，用于合流时搬迁旧标注 */
  sourcePos?: number;
  draftPos?: number;
  basePos?: number;
}

export interface MergeLine {
  /** 稳定行键（s{来源行}/d{当前行}/b{快照行}），冲突选择按它记录 */
  rowKey: string;
  index: number;
  state: LineMergeState;
  cells: MergeCell[];
  /** 冲突句的选定来源；未选则合流失败 */
  choice?: LineChoice;
  sourceLine?: number;
  draftLine?: number;
  baseLine?: number;
}

export type MergeBatchStatus = 'open' | 'failed' | 'merged';

/**
 * 宋刻本校勘批次。
 * 快照只保存来源正文（sourceLines）与合流前当前稿正文（draftSnapshot）；
 * 平仄、韵组、停顿、对仗全部是候选，不直接覆盖当前稿。
 */
export interface MergeBatch {
  id: string;
  sourceName: string;
  sourceRef: string;
  targetVersionId: string;
  createdAt: string;
  status: MergeBatchStatus;
  /** 来源正文逐行快照 */
  sourceLines: string[];
  /** 导入时当前稿正文逐行快照：失配重算的基准 */
  draftSnapshot: string[];
  /** 来源逐字标注（行:位置），仅作候选 */
  sourceMarks: Record<string, CandidateMark>;
  antithesisSuggestions: AntithesisSuggestion[];
  /** 冲突句已确认的选择（键为稳定行键 rowKey），失败重试后仍然保留 */
  conflictChoices?: Record<string, LineChoice>;
  lastError?: string;
  mergedAt?: string;
}

export interface MergePreview {
  batchId: string;
  lines: MergeLine[];
  conflicts: number;
  sourceOnly: number;
  draftOnly: number;
  equal: number;
  ready: boolean;
  /** 合流后将新增的待复核字数（来源真正改过的字） */
  pendingCount: number;
}

/** 合流产出：新正文、搬迁后的标注、待复核位置清单 */
export interface PendingPosition {
  line: number;
  position: number;
  char: string;
  source: string;
  candidate?: CandidateMark;
}

export interface MergeApplied {
  ok: boolean;
  error?: string;
  text?: string;
  marks?: Record<string, CharacterMark>;
  antithesisPairs?: AntithesisPair[];
  pendingPositions?: PendingPosition[];
  /** 来源行号 → 合流后行号，供对仗建议映射 */
  sourceLineMap?: Record<number, number>;
}

export interface PoemVersion {
  id: string;
  name: string;
  source: string;
  createdAt: string;
  text: string;
  marks: Record<string, CharacterMark>;
  antithesisPairs: AntithesisPair[];
}

export interface AntithesisPair {
  id: string;
  leftLine: number;
  rightLine: number;
  note: string;
}

export interface PoemWorkspace {
  title: string;
  author: string;
  templateId: string;
  versions: PoemVersion[];
  activeVersionId: string;
  updatedAt: string;
  /** 所有批次持久保留：失败重试不丢选择，成功后也可供追溯 */
  mergeBatches?: MergeBatch[];
  activeBatchId?: string;
}

export interface MeterTemplate {
  id: string;
  name: string;
  summary: string;
  lineCount: number;
  lineLength: number;
  pattern: Tone[];
  rhymeLines: number[];
}

export interface AnalysisCell {
  char: string;
  position: number;
  expected: Tone;
  actual: Tone;
  status: 'correct' | 'variant' | 'error' | 'unknown' | 'neutral';
  message: string;
  mark: CharacterMark;
}

export interface AnalysisLine {
  index: number;
  cells: AnalysisCell[];
  rhymeChars: string[];
  errors: number;
  variants: number;
}

export interface PoemIssue {
  id: string;
  level: 'error' | 'warning' | 'info';
  title: string;
  detail: string;
  line?: number;
  position?: number;
}

export interface CharDiff {
  index: number;
  left: string;
  right: string;
  changed: boolean;
  /** 右方字处于待复核 */
  pending?: boolean;
  originSource?: string;
  candidate?: CandidateMark;
}

/** LCS 对齐操作：base/other 下标，null 表示该侧插入 */
export interface MatchOp {
  base: number | null;
  other: number | null;
}

export interface ThreeWayRow {
  base: number | null;
  source: number | null;
  draft: number | null;
}

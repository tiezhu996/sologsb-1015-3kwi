export type Tone = '平' | '仄' | '中' | '?';
export type MarkTone = '平' | '仄' | '中';

export interface CharacterMark {
  tone: MarkTone | '?';
  rhyme: string;
  pauseAfter: boolean;
  basis: string;
  note: string;
  pendingReview?: boolean;
  reviewSource?: string;
}

/** 校勘员批次中的单字候选标注 */
export interface CollationBatchMark {
  line: number;
  position: number;
  char?: string;
  tone?: MarkTone;
  rhyme?: string;
  pauseAfter?: boolean;
  basis?: string;
  note?: string;
}

/** 校勘员从宋刻本带回的逐字标注批次 */
export interface CollationBatch {
  batchId?: string;
  source: string;
  name?: string;
  text?: string;
  lines?: string[];
  marks?: CollationBatchMark[];
  antithesis?: Array<{ leftLine: number; rightLine: number; note?: string }>;
}

export interface MergeCandidate {
  tone?: MarkTone;
  rhyme?: string;
  pauseAfter?: boolean;
  basis?: string;
  note?: string;
}

export type MergeItemKind = 'text' | 'mark' | 'antithesis';

/** 合流复核条目：异文、候选标注或候选对仗 */
export interface MergeItem {
  id: string;
  kind: MergeItemKind;
  line?: number;
  position?: number;
  char?: string;
  /** text：当前稿用字 */
  current?: string;
  /** text：宋刻本来字 */
  incoming?: string;
  /** mark：候选字段 */
  field?: 'tone' | 'rhyme' | 'pauseAfter';
  currentValue?: string;
  incomingValue?: string;
  candidate?: MergeCandidate;
  pair?: { leftLine: number; rightLine: number; note: string };
  /** current = 保留当前稿 / 忽略建议；incoming = 采用宋刻本 */
  choice: 'current' | 'incoming';
  decided: boolean;
}

export interface MergeSession {
  id: string;
  batchId: string;
  source: string;
  label: string;
  targetVersionId: string;
  /** 只装来源正文的版本快照，重试时复用，不重复生成 */
  snapshotVersionId: string;
  status: 'pending' | 'applied' | 'cancelled';
  items: MergeItem[];
  createdAt: string;
  appliedAt?: string;
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
  mergeSessions: MergeSession[];
  updatedAt: string;
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
}

import { Injectable } from '@angular/core';
import type {
  CandidateMark,
  CharacterMark,
  MatchOp,
  MergeApplied,
  MergeBatch,
  MergeCell,
  MergeLine,
  MergePreview,
  PoemVersion,
  ThreeWayRow,
} from '../models/poem.models';

const PUNCT = /[\s，。！？；：、,.!?;:·…—–\-（）()【】\[\]「」『』《》“”‘’]/u;
export const isPunct = (ch: string): boolean => PUNCT.test(ch);
export const lineChars = (line: string): string[] => Array.from(line).filter((ch) => !isPunct(ch));
export const markKey = (line: number, position: number): string => `${line}:${position}`;

export function blankMark(): CharacterMark {
  return { tone: '?', rhyme: '', pauseAfter: false, basis: '', note: '' };
}

export function blankCandidate(): CandidateMark {
  return { tone: '?', rhyme: '', pauseAfter: false, basis: '', note: '' };
}

export function rowKey(row: ThreeWayRow): string {
  return `b${row.base ?? 'x'}-s${row.source ?? 'x'}-d${row.draft ?? 'x'}`;
}

/** 以导入时快照为轴：行级配对（整行相同或足够相似才锚定到基准行），再按快照行合并 */
export function threeWayAlign(base: string[], source: string[], draft: string[]): ThreeWayRow[] {
  const sPair = pairLines(base, source);
  const dPair = pairLines(base, draft);
  const sourceAt = sPair.matched;
  const draftAt = dPair.matched;
  const sIns = sPair.insertsAfter;
  const dIns = dPair.insertsAfter;

  const rows: ThreeWayRow[] = [];
  const head = Math.max((sIns.get(-1) ?? []).length, (dIns.get(-1) ?? []).length);
  const sHead = sIns.get(-1) ?? [];
  const dHead = dIns.get(-1) ?? [];
  for (let k = 0; k < head; k++) rows.push({ base: null, source: sHead[k] ?? null, draft: dHead[k] ?? null });

  for (let b = 0; b < base.length; b++) {
    const s = sourceAt.get(b) ?? null;
    const d = draftAt.get(b) ?? null;
    // 基准行两侧均已删除（两侧都未配对）才跳过
    if (s !== null || d !== null) {
      rows.push({ base: b, source: s, draft: d });
    }
    const si = sIns.get(b) ?? [];
    const di = dIns.get(b) ?? [];
    for (let k = 0; k < Math.max(si.length, di.length); k++) {
      rows.push({ base: null, source: si[k] ?? null, draft: di[k] ?? null });
    }
  }
  return rows;
}

/** 通用编辑距离对齐（元素可为行或字符）：允许同位替换，避免“改字”被拆成删+增 */
export function align(base: string[], other: string[]): MatchOp[] {
  const n = base.length;
  const m = other.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const diag = dp[i - 1][j - 1] + (base[i - 1] === other[j - 1] ? 0 : 1);
      const del = dp[i - 1][j] + 1;
      const ins = dp[i][j - 1] + 1;
      dp[i][j] = Math.min(diag, del, ins);
    }
  }
  const ops: MatchOp[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const diagCost = dp[i - 1][j - 1] + (base[i - 1] === other[j - 1] ? 0 : 1);
      // 同代价时优先对角线（替换同位对齐），其次保持原有方向
      if (dp[i][j] === diagCost) {
        ops.unshift({ base: i - 1, other: j - 1 });
        i--;
        j--;
        continue;
      }
    }
    if (j > 0 && (i === 0 || dp[i][j - 1] <= dp[i - 1][j])) {
      ops.unshift({ base: null, other: j - 1 });
      j--;
    } else {
      ops.unshift({ base: i - 1, other: null });
      i--;
    }
  }
  return ops;
}

/** 最长公共连续子串长度 */
function longestCommonSubstring(a: string[], b: string[]): number {
  let best = 0;
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
        best = Math.max(best, dp[i][j]);
      }
    }
  }
  return best;
}

interface LinePairing {
  matched: Map<number, number>;
  insertsAfter: Map<number, number[]>;
}

/** 行长度的字符级相似度（1 为相同），标点不参与 */
function lineSimilarity(a: string, b: string): number {
  const ca = lineChars(a);
  const cb = lineChars(b);
  if (!ca.length || !cb.length) return a === b ? 1 : 0;
  // LCS 长度 / 较长行长度：允许少量改字仍锚定为同一行
  const n = ca.length;
  const m = cb.length;
  const dp = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    let prev = 0;
    for (let j = 1; j <= m; j++) {
      const tmp = dp[j];
      dp[j] = ca[i - 1] === cb[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[m] / Math.max(n, m);
}

/**
 * 行配对：先锚定完全相同行，再贪心配对相似度 ≥ 0.5 的行（行内改一两个字仍属同一行），
 * 其余 other 行视为新增，挂在上一个已配对基准行之后。
 */
function pairLines(base: string[], other: string[]): LinePairing {
  const matched = new Map<number, number>();
  const usedOther = new Set<number>();
  // 1) 完全相同
  base.forEach((bLine, bi) => {
    const oj = other.findIndex((oLine, idx) => !usedOther.has(idx) && oLine === bLine);
    if (oj >= 0) {
      matched.set(bi, oj);
      usedOther.add(oj);
    }
  });
  // 2) 贪心相似配对
  const candidates: Array<{ bi: number; oj: number; score: number }> = [];
  base.forEach((bLine, bi) => {
    if (matched.has(bi)) return;
    const cb = lineChars(bLine);
    other.forEach((oLine, oj) => {
      if (usedOther.has(oj)) return;
      const co = lineChars(oLine);
      // 长度变长时，需要保留足够长的共同连续字串才视为同一行（插入一两个字），否则按新增行
      if (co.length > cb.length && longestCommonSubstring(cb, co) < cb.length - 1) return;
      // 长度差过大不锚定（多半是新增行）
      if (Math.abs(cb.length - co.length) > 1) return;
      // 允许的改动字数：行长的 1/3 向下取整、至少 1 字
      const allowedEdits = Math.max(1, Math.floor(cb.length / 3));
      const score = lineSimilarity(bLine, oLine);
      const lcs = Math.round(score * Math.max(cb.length, co.length));
      if (Math.max(cb.length, co.length) - lcs <= allowedEdits) candidates.push({ bi, oj, score });
    });
  });
  candidates.sort((a, b) => b.score - a.score).forEach(({ bi, oj }) => {
    if (!matched.has(bi) && !usedOther.has(oj)) {
      matched.set(bi, oj);
      usedOther.add(oj);
    }
  });

  // 3) 新增行：按 other 原始顺序，挂在上一个匹配基准行后
  const insertsAfter = new Map<number, number[]>();
  let last = -1;
  const matchedReverse = new Map<number, number>();
  matched.forEach((oj, bi) => matchedReverse.set(oj, bi));
  other.forEach((_, oj) => {
    if (usedOther.has(oj)) {
      if (matchedReverse.has(oj)) last = matchedReverse.get(oj)!;
    } else {
      const list = insertsAfter.get(last) ?? [];
      list.push(oj);
      insertsAfter.set(last, list);
    }
  });
  return { matched, insertsAfter };
}

@Injectable({ providedIn: 'root' })
export class MergeEngine {
  preview(batch: MergeBatch, version: PoemVersion): MergePreview {
    const draftLines = version.text.split('\n');
    const rows = threeWayAlign(batch.draftSnapshot, batch.sourceLines, draftLines);
    const choices = batch.conflictChoices ?? {};

    const lines: MergeLine[] = [];
    let conflicts = 0;
    let sourceOnly = 0;
    let draftOnly = 0;
    let equal = 0;
    let pendingCount = 0;

    rows.forEach((row) => {
      const cells = this.buildCells(batch, row, draftLines);
      const kinds = new Set(cells.map((cell) => cell.status));
      let state: MergeLine['state'];
      if (kinds.has('conflict') || kinds.has('insert-conflict')) {
        state = 'conflict';
        conflicts++;
      } else if (kinds.has('source') || kinds.has('source-insert')) {
        state = 'source';
        sourceOnly++;
      } else if (kinds.has('draft') || kinds.has('draft-insert')) {
        state = 'draft';
        draftOnly++;
      } else {
        state = 'equal';
        equal++;
      }
      const choice = state === 'conflict' ? choices[rowKey(row)] : undefined;
      if (state === 'conflict' && !choice) {
        pendingCount += cells.filter((cell) => cell.conflict).length;
      } else if (state === 'conflict' && choice === 'source') {
        pendingCount += cells.filter((cell) => cell.conflict && cell.sourceChar !== cell.baseChar).length;
      } else if (state === 'source') {
        pendingCount += cells.filter((cell) => (cell.status === 'source' || cell.status === 'source-insert') && cell.sourceChar !== cell.baseChar).length;
      }
      lines.push({ rowKey: rowKey(row), index: lines.length, state, cells, choice, sourceLine: row.source ?? undefined, draftLine: row.draft ?? undefined, baseLine: row.base ?? undefined });
    });

    return {
      batchId: batch.id,
      lines,
      conflicts,
      sourceOnly,
      draftOnly,
      equal,
      ready: conflicts === 0 || lines.every((line) => line.state !== 'conflict' || line.choice),
      pendingCount,
    };
  }

  /** 按选定结果执行合流；未全部决择则拒绝（失败），批次与已确认选择保留 */
  apply(batch: MergeBatch, preview: MergePreview, version: PoemVersion): MergeApplied {
    const unresolved = preview.lines.filter((line) => line.state === 'conflict' && !line.choice);
    if (unresolved.length) {
      return { ok: false, error: `尚有 ${unresolved.length} 处两边同改的冲突句并列未决，已保留批次与已确认选择，可重试合流。` };
    }

    const draftLines = version.text.split('\n');
    const mergedTextLines: string[] = [];
    const newMarks: Record<string, CharacterMark> = {};
    const pendingPositions: MergeApplied['pendingPositions'] = [];
    const sourceLineMap: Record<number, number> = {};

    preview.lines.forEach((line) => {
      const outLine = mergedTextLines.length;

      // 行正文：先按逐字列取最终采用字，再套用采用侧原标点
      const takeSourceLine = line.state === 'source'
        || (line.state === 'conflict' && line.choice === 'source');
      const chosenChars = line.cells.map((cell) => this.chosenChar(cell, line.choice));
      const textLine = this.applyPunctuation(chosenChars, takeSourceLine && line.sourceLine !== undefined
        ? batch.sourceLines[line.sourceLine]
        : line.draftLine !== undefined
          ? draftLines[line.draftLine]
          : null);
      mergedTextLines.push(textLine);
      if (line.sourceLine !== undefined) sourceLineMap[line.sourceLine] = outLine;

      line.cells.forEach((cell, position) => {
        const fromSource = cell.status === 'source' || cell.status === 'source-insert'
          || ((cell.status === 'conflict' || cell.status === 'insert-conflict') && line.choice === 'source');
        const char = fromSource ? cell.sourceChar : cell.draftChar;

        const replacedInPlace = cell.basePos !== undefined && cell.sourceChar !== cell.baseChar;
        const pureNewSlot = fromSource && cell.basePos === undefined && cell.draftPos === undefined;
        if (fromSource && (replacedInPlace || pureNewSlot)) {
          // 来源在原位置真正改了字（含冲突选来源），或纯新增字：候选入档，转待复核
          const candidate = cell.candidate ?? (line.sourceLine !== undefined ? batch.sourceMarks[markKey(line.sourceLine, cell.sourcePos ?? position)] : undefined);
          newMarks[markKey(outLine, position)] = {
            ...blankMark(),
            status: 'pending',
            candidate: candidate ? { ...blankCandidate(), ...candidate } : undefined,
            originBatchId: batch.id,
            originSource: batch.sourceName,
          };
          pendingPositions!.push({ line: outLine, position, char, source: batch.sourceName, candidate: newMarks[markKey(outLine, position)].candidate });
        } else if (cell.draftPos !== undefined && line.draftLine !== undefined) {
          // 其余位置照旧（含来源纯新增字挤位、未改字、冲突选当前稿）：搬迁当前稿原标注
          const old = version.marks[markKey(line.draftLine, cell.draftPos)];
          if (old) {
            newMarks[markKey(outLine, position)] = {
              ...old,
              candidate: old.candidate ? { ...old.candidate } : undefined,
            };
          }
        }
      });
    });

    // 对仗建议：仅写入明确接受项，并按合流后行号映射
    const antithesisPairs = [...version.antithesisPairs];
    batch.antithesisSuggestions.filter((item) => item.decision === 'accept').forEach((suggestion) => {
      const l = sourceLineMap[suggestion.leftLine];
      const r = sourceLineMap[suggestion.rightLine];
      if (l === undefined || r === undefined || l === r) return;
      if (antithesisPairs.some((pair) => pair.leftLine === l && pair.rightLine === r)) return;
      antithesisPairs.push({
        id: `pair-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        leftLine: l,
        rightLine: r,
        note: suggestion.note,
      });
    });

    return {
      ok: true,
      text: mergedTextLines.join('\n'),
      marks: newMarks,
      antithesisPairs,
      pendingPositions,
      sourceLineMap,
    };
  }

  private chosenChar(cell: MergeCell, choice: MergeLine['choice']): string {
    if (cell.status === 'draft' || cell.status === 'draft-insert') return cell.draftChar;
    if (cell.status === 'source' || cell.status === 'source-insert') return cell.sourceChar;
    if (cell.status === 'conflict' || cell.status === 'insert-conflict') {
      return choice === 'source' ? cell.sourceChar : cell.draftChar;
    }
    return cell.draftChar || cell.sourceChar;
  }

  /** 给逐字结果重新套上原行标点：按字符序在原行中找到对应字，取其后标点 */
  private applyPunctuation(chars: string[], templateLine: string | null): string {
    if (!templateLine) return chars.join('');
    let out = '';
    let cursor = 0;
    const template = Array.from(templateLine);
    chars.forEach((ch, idx) => {
      out += ch;
      // 在模板中向后找到该字（允许模板因删字缺字）
      let found = -1;
      for (let p = cursor; p < template.length; p++) {
        if (template[p] === ch && isPunct(template[p]) === false) {
          found = p;
          break;
        }
      }
      if (found >= 0) {
        let q = found + 1;
        while (q < template.length && isPunct(template[q])) {
          out += template[q];
          q++;
        }
        cursor = found + 1;
      }
      void idx;
    });
    return out;
  }

  private buildCells(batch: MergeBatch, row: ThreeWayRow, draftLines: string[]): MergeCell[] {
    const baseChars = row.base !== null ? lineChars(batch.draftSnapshot[row.base]) : [];
    const sourceChars = row.source !== null ? lineChars(batch.sourceLines[row.source]) : [];
    const draftChars = row.draft !== null ? lineChars(draftLines[row.draft]) : [];
    const triples = row.base === null
      ? pairwiseTriples(sourceChars, draftChars)
      : threeWayCharAlign(baseChars, sourceChars, draftChars);

    return triples.map(([bIdx, sIdx, dIdx]) => {
      const b = bIdx !== null ? baseChars[bIdx] : '';
      const s = sIdx !== null ? sourceChars[sIdx] : '';
      const d = dIdx !== null ? draftChars[dIdx] : '';
      let status: MergeCell['status'];
      if (bIdx === null) {
        // 无基准列：两侧新增并列
        if (sIdx !== null && dIdx !== null) status = s === d ? 'equal' : 'insert-conflict';
        else if (sIdx !== null) status = 'source-insert';
        else status = 'draft-insert';
      } else {
        const sChanged = sIdx !== null && s !== b;
        const dChanged = dIdx !== null && d !== b;
        const sMissing = sIdx === null;
        const dMissing = dIdx === null;
        if (sChanged && dChanged) status = 'conflict';
        else if (sChanged) status = 'source';
        else if (dChanged) status = 'draft';
        else if (sMissing && !dMissing) status = 'draft'; // 来源删字、当前稿保留
        else if (dMissing && !sMissing) status = 'source'; // 当前稿删字、来源保留
        else status = 'equal';
      }
      return {
        key: markKey(row.source ?? 0, 0),
        status,
        sourceChar: s,
        draftChar: d,
        baseChar: b,
        conflict: status === 'conflict' || status === 'insert-conflict',
        candidate: sIdx !== null && row.source !== null ? batch.sourceMarks[markKey(row.source, sIdx)] : undefined,
        sourcePos: sIdx ?? undefined,
        draftPos: dIdx ?? undefined,
        basePos: bIdx ?? undefined,
      };
    });
  }
}

type Triple = [number | null, number | null, number | null];

/** 无基准行时：两侧新增字符按编辑距离对齐 */
function pairwiseTriples(sourceChars: string[], draftChars: string[]): Triple[] {
  return align(sourceChars, draftChars).map((op) => [null, op.base, op.other]);
}

/**
 * 三序列（基/来源/当前稿）逐字对齐，三序列编辑距离 DP：
 * 每列可含 base/source/draft 任意非空子集；诗句行长 ≤ 十几字，O(n·m·k) 可接受。
 */
/** 行内三序列逐字对齐（对外包装，供正文改动重算复用） */
export function alignThreeChars(baseChars: string[], sourceChars: string[], draftChars: string[]): Triple[] {
  return threeWayCharAlign(baseChars, sourceChars, draftChars);
}

/**
 * diff3 式三序列逐字对齐：
 * 1) 分别对 基↔来源、基↔当前稿 做编辑距离对齐；
 * 2) 仅当“基字=来源字=当前稿字”时作为稳定锚点列；
 * 3) 锚点之间的区间用三方 DP 填充。
 */
function threeWayCharAlign(baseChars: string[], sourceChars: string[], draftChars: string[]): Triple[] {
  const sOps = align(baseChars, sourceChars);
  const dOps = align(baseChars, draftChars);
  const sourceOfBase = new Map<number, number>();
  const draftOfBase = new Map<number, number>();
  sOps.forEach((op) => {
    if (op.base !== null && op.other !== null && baseChars[op.base] === sourceChars[op.other]) sourceOfBase.set(op.base, op.other);
  });
  dOps.forEach((op) => {
    if (op.base !== null && op.other !== null && baseChars[op.base] === draftChars[op.other]) draftOfBase.set(op.base, op.other);
  });

  // 稳定锚点：base 位两侧都匹配且三字相同
  const anchors: number[] = [];
  for (let b = 0; b < baseChars.length; b++) {
    const si = sourceOfBase.get(b);
    const di = draftOfBase.get(b);
    if (si !== undefined && di !== undefined) anchors.push(b);
  }

  // 区间内三方 DP（不含强制锚点）
  const fill = (b0: number, b1: number, s0: number, s1: number, d0: number, d1: number): Triple[] => {
    const B = baseChars.slice(b0, b1);
    const S = sourceChars.slice(s0, s1);
    const D = draftChars.slice(d0, d1);
    return triDP(B, S, D).map(([b, s, d]) => [
      b === null ? null : b + b0,
      s === null ? null : s + s0,
      d === null ? null : d + d0,
    ]);
  };

  const triples: Triple[] = [];
  let pb = 0;
  let ps = 0;
  let pd = 0;
  anchors.forEach((b) => {
    const si = sourceOfBase.get(b)!;
    const di = draftOfBase.get(b)!;
    triples.push(...fill(pb, b, ps, si, pd, di));
    triples.push([b, si, di]); // 锚点列
    pb = b + 1;
    ps = si + 1;
    pd = di + 1;
  });
  triples.push(...fill(pb, baseChars.length, ps, sourceChars.length, pd, draftChars.length));
  return triples;
}

/** 小区间三方编辑距离 DP，返回局部下标三元组列 */
function triDP(B: string[], S: string[], D: string[]): Triple[] {
  const n = B.length;
  const sn = S.length;
  const dn = D.length;
  if (!n && !sn && !dn) return [];

  const cost = (b: number | null, s: number | null, d: number | null): number => {
    const chars = [b !== null ? B[b] : null, s !== null ? S[s] : null, d !== null ? D[d] : null];
    const used = chars.filter((x): x is string => x !== null).length;
    if (used === 0) return Infinity;
    const distinct = new Set(chars.filter((x): x is string => x !== null)).size;
    if (used === 3) return distinct - 1; // 三方列：每多一种异文计 1（冲突列仍保持一列）
    if (used === 2) return distinct === 1 ? 0 : 1; // 双方列：相同为匹配，不同为替换
    return 1; // 单侧插入/删除
  };

  const dp: number[][][] = Array.from({ length: n + 1 }, () =>
    Array.from({ length: sn + 1 }, () => new Array<number>(dn + 1).fill(Infinity)));
  const back: Array<Array<Array<[number, number, number] | null>>> = Array.from({ length: n + 1 }, () =>
    Array.from({ length: sn + 1 }, () => new Array(dn + 1).fill(null)));
  dp[0][0][0] = 0;

  // 同代价时的优先级：三方列 > 双方列 > 单侧列，使匹配尽量成列
  const steps: Array<[number, number, number]> = [
    [1, 1, 1], [1, 1, 0], [1, 0, 1], [0, 1, 1], [1, 0, 0], [0, 1, 0], [0, 0, 1],
  ];
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= sn; j++) {
      for (let k = 0; k <= dn; k++) {
        if (i === 0 && j === 0 && k === 0) continue;
        let best = Infinity;
        let bestStep: [number, number, number] | null = null;
        for (const [di, dj, dk] of steps) {
          const pi = i - di;
          const pj = j - dj;
          const pk = k - dk;
          if (pi < 0 || pj < 0 || pk < 0) continue;
          const value = dp[pi][pj][pk] + cost(di ? i - 1 : null, dj ? j - 1 : null, dk ? k - 1 : null);
          if (value < best) {
            best = value;
            bestStep = [di, dj, dk];
          }
        }
        dp[i][j][k] = best;
        back[i][j][k] = bestStep;
      }
    }
  }

  const out: Triple[] = [];
  let i = n;
  let j = sn;
  let k = dn;
  while (i > 0 || j > 0 || k > 0) {
    const step = back[i][j][k];
    if (!step) break;
    const [di, dj, dk] = step;
    out.unshift([di ? i - 1 : null, dj ? j - 1 : null, dk ? k - 1 : null]);
    i -= di;
    j -= dj;
    k -= dk;
  }
  return out;
}

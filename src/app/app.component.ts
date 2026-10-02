import { ChangeDetectionStrategy, Component, HostListener, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzBadgeModule } from 'ng-zorro-antd/badge';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzDividerModule } from 'ng-zorro-antd/divider';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzProgressModule } from 'ng-zorro-antd/progress';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzSwitchModule } from 'ng-zorro-antd/switch';
import { NzTabsModule } from 'ng-zorro-antd/tabs';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { METER_TEMPLATES, PoetryStoreService, type BatchImportPayload } from './services/poetry-store.service';
import type { CandidateMark, LineChoice } from './models/poem.models';

/** 示例批次：来源正文与当前稿仅第三句不同（“夜阑”异文），格律标注与对仗均为候选 */
const EXAMPLE_BATCH = `{
  "sourceName": "宋蜀刻本（示例）",
  "sourceRef": "宋蜀刻本《孟浩然诗集》卷三 · 批次 SN-001",
  "text": "春眠不觉晓，\\n处处闻啼鸟。\\n夜阑风雨声，\\n花落知多少。",
  "marks": {
    "0:4": { "tone": "仄", "rhyme": "A", "pauseAfter": false, "basis": "刻本朱点", "note": "韵脚候选" },
    "1:4": { "tone": "仄", "rhyme": "A", "pauseAfter": false, "basis": "刻本朱点", "note": "韵脚候选" },
    "2:1": { "tone": "平", "rhyme": "", "pauseAfter": false, "basis": "《广韵》", "note": "阑，平声寒韵" },
    "2:4": { "tone": "平", "rhyme": "A", "pauseAfter": false, "basis": "刻本朱点", "note": "韵脚候选" },
    "3:4": { "tone": "仄", "rhyme": "A", "pauseAfter": false, "basis": "刻本朱点", "note": "韵脚候选" }
  },
  "antithesis": [
    { "leftLine": 1, "rightLine": 2, "note": "刻本批点：次联“闻啼鸟／风雨声”属对候选" }
  ]
}`;

@Component({
  selector: 'app-root',
  imports: [
    CommonModule,
    FormsModule,
    NzAlertModule,
    NzBadgeModule,
    NzButtonModule,
    NzDividerModule,
    NzEmptyModule,
    NzInputModule,
    NzProgressModule,
    NzSelectModule,
    NzSwitchModule,
    NzTabsModule,
    NzTagModule,
    NzToolTipModule,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.less',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  readonly store = inject(PoetryStoreService);
  readonly templates = METER_TEMPLATES;
  readonly selectedCell = computed(() => this.store.selectedCell());

  readonly importJson = signal('');
  readonly importError = signal('');
  readonly activeMergeTab = signal(0);
  readonly topTabIndex = signal(0);

  get totalErrors(): number {
    return this.store.issues().filter((issue) => issue.level === 'error').length;
  }

  get totalWarnings(): number {
    return this.store.issues().filter((issue) => issue.level === 'warning').length;
  }

  get checkedRate(): number {
    const cells = this.store.analysis().flatMap((line) => line.cells);
    if (!cells.length) return 0;
    return Math.round((cells.filter((cell) => cell.actual !== '?').length / cells.length) * 100);
  }

  setTone(tone: '平' | '仄' | '中' | '?'): void {
    this.store.setMark({ tone });
  }

  updateSource(source: string): void {
    this.store.setMark({ basis: source });
  }

  updateVersionSource(source: string): void {
    this.store.updateVersionSource(source);
  }

  trackTemplate(index: number, item: (typeof METER_TEMPLATES)[number]): string {
    return item.id;
  }

  // ---------- 批次导入 ----------

  loadExampleBatch(): void {
    this.importJson.set(EXAMPLE_BATCH);
    this.importError.set('');
  }

  submitImport(): void {
    const raw = this.importJson().trim();
    if (!raw) {
      this.importError.set('请粘贴宋刻本逐字标注批次（JSON）');
      return;
    }
    let payload: BatchImportPayload;
    try {
      payload = JSON.parse(raw) as BatchImportPayload;
    } catch (error) {
      this.importError.set(`JSON 解析失败：${(error as Error).message}`);
      return;
    }
    if (!payload.sourceName || !payload.text) {
      this.importError.set('批次至少需要 sourceName（来源名）与 text（来源正文，\\n 分行）');
      return;
    }
    const result = this.store.importBatch(payload);
    if (!result.ok) {
      this.importError.set(result.error ?? '导入失败');
      return;
    }
    this.importError.set('');
    this.importJson.set('');
    this.activeMergeTab.set(1);
  }

  choose(rowKey: string, value: LineChoice): void {
    this.store.chooseConflict(rowKey, value);
  }

  pendingSourceSummary(): string {
    const groups = this.store.pendingBySource();
    return groups.length ? groups.map((g) => `${g.source}（${g.count}字）`).join('、') : '';
  }

  markCount(marks: Record<string, CandidateMark>): number {
    return Object.keys(marks).length;
  }

  @HostListener('document:keydown', ['$event'])
  handleKeyboard(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const inTextEntry = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.getAttribute('contenteditable') === 'true';
    const command = event.ctrlKey || event.metaKey;

    if (command && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      event.shiftKey ? this.store.redo() : this.store.undo();
      return;
    }
    if (command && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      this.store.redo();
      return;
    }
    if (command && event.key.toLowerCase() === 's') {
      event.preventDefault();
      this.store.toast.set('内容已保存在本机');
      return;
    }
    if (inTextEntry) return;

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      const line = this.store.analysis()[this.store.selectedLine()];
      const next = Math.max(0, this.store.selectedPosition() - 1);
      this.store.selectCell(this.store.selectedLine(), Math.min(next, Math.max(0, line?.cells.length - 1)));
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      const line = this.store.analysis()[this.store.selectedLine()];
      const next = Math.min((line?.cells.length ?? 1) - 1, this.store.selectedPosition() + 1);
      this.store.selectCell(this.store.selectedLine(), next);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const next = Math.max(0, this.store.selectedLine() - 1);
      const max = Math.max(0, (this.store.analysis()[next]?.cells.length ?? 1) - 1);
      this.store.selectCell(next, Math.min(this.store.selectedPosition(), max));
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = Math.min(this.store.analysis().length - 1, this.store.selectedLine() + 1);
      const max = Math.max(0, (this.store.analysis()[next]?.cells.length ?? 1) - 1);
      this.store.selectCell(next, Math.min(this.store.selectedPosition(), max));
    } else if (event.key === '1') {
      this.setTone('平');
    } else if (event.key === '2') {
      this.setTone('仄');
    } else if (event.key === '3') {
      this.setTone('中');
    } else if (event.key === ' ') {
      event.preventDefault();
      this.store.togglePause();
    } else if (event.key.toLowerCase() === 'r') {
      this.store.cycleRhyme();
    }
  }
}

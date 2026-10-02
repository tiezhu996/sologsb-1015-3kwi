import { ChangeDetectionStrategy, Component, HostListener, computed, inject } from '@angular/core';
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
import { METER_TEMPLATES, PoetryStoreService } from './services/poetry-store.service';
import type { MergeItem } from './models/poem.models';

const SAMPLE_BATCH = JSON.stringify(
  {
    batchId: 'song-shuke-chunxiao-01',
    source: '宋蜀刻本《孟浩然诗集》',
    name: '宋刻本 · 春晓批校',
    lines: ['春眠不觉晓，', '处处闻鸣鸟。', '夜来风雨声，', '花落知多少。'],
    marks: [
      { line: 0, position: 4, char: '晓', tone: '仄', rhyme: '上声十七筱', pauseAfter: false, basis: '宋本朱笔旁注', note: '晓字圈点，校为仄声' },
      { line: 1, position: 2, char: '鸣', tone: '平', rhyme: '', pauseAfter: false, basis: '宋本作“鸣”', note: '异文：啼→鸣' },
      { line: 1, position: 4, char: '鸟', tone: '仄', rhyme: '上声十七筱', pauseAfter: true, basis: '宋本圈发', note: '句读小停' },
      { line: 2, position: 2, char: '雨', tone: '仄', rhyme: '', pauseAfter: true, basis: '宋本句读', note: '风雨之间一顿' },
      { line: 3, position: 4, char: '少', tone: '仄', rhyme: '上声十七筱', pauseAfter: false, basis: '宋本朱笔', note: '' },
    ],
    antithesis: [{ leftLine: 0, rightLine: 3, note: '宋本批：起结相应，意境对仗。' }],
  },
  null,
  2,
);

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

  batchInput = '';
  readonly sampleBatch = SAMPLE_BATCH;

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

  get pendingCount(): number {
    return this.store.pendingReviewCount().count;
  }

  get pendingSources(): string[] {
    return this.store.pendingReviewCount().sources;
  }

  readonly mergeSession = computed(() => this.store.activeMergeSession());

  readonly mergeGroups = computed(() => {
    const session = this.mergeSession();
    if (!session) return [];
    const byLine = new Map<number, MergeItem[]>();
    for (const item of session.items) {
      const line = item.line ?? -1;
      byLine.set(line, [...(byLine.get(line) ?? []), item]);
    }
    return [...byLine.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([line, items]) => ({ line, items }));
  });

  startMerge(): void {
    this.store.startMerge(this.batchInput);
  }

  loadSampleBatch(): void {
    this.batchInput = SAMPLE_BATCH;
    this.store.mergeError.set('');
  }

  choose(item: MergeItem, choice: 'current' | 'incoming'): void {
    this.store.setMergeChoice(item.id, choice);
  }

  chooseLine(line: number, choice: 'current' | 'incoming'): void {
    this.store.setMergeChoicesForLine(line, choice);
  }

  fieldLabel(field: string): string {
    return field === 'tone' ? '平仄' : field === 'rhyme' ? '韵组' : '停顿';
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

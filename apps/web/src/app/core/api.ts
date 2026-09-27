import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, httpResource } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { EventKind, Overview } from '@battlestation/domain';

export interface Health {
  ok: boolean;
  version: string;
  today: string;
  mode: 'live' | 'mock';
}

/**
 * Client of the local API. The shapes are the domain's own types; the screen
 * works out nothing the domain has not already worked out.
 */
@Injectable({ providedIn: 'root' })
export class Api {
  readonly health = httpResource<Health>(() => '/api/health');
  readonly overview = httpResource<Overview>(() => '/api/overview');

  private readonly http = inject(HttpClient);

  /** A change from the screen. Reloads the picture afterwards; a refusal comes back as its reason. */
  private async write<T = unknown>(path: string, body: unknown): Promise<{ refused: string | null; value: T | null }> {
    try {
      const value = await firstValueFrom(this.http.post<T>(path, body));
      this.overview.reload();
      return { refused: null, value };
    } catch (err) {
      const e = err as HttpErrorResponse;
      return { refused: (e.error as { error?: string } | null)?.error ?? 'The Battlestation server did not accept that.', value: null };
    }
  }

  markSeen(body: { keys?: string[]; all?: boolean }) {
    return this.write('/api/issues/seen', body);
  }

  noteIssue(body: { key: string; note: string }) {
    return this.write('/api/issues/note', body);
  }

  saveTask(body: { id?: string; title?: string; type?: string; description?: string; issueKey?: string | null; sprintId?: string | null }) {
    return this.write<{ id: string }>('/api/tasks/save', body);
  }

  setTaskStatus(body: { id: string; status: 'todo' | 'doing' | 'blocked' | 'done' | 'dropped'; reason?: string }) {
    return this.write('/api/tasks/status', body);
  }

  saveEvent(body: { id?: string; title?: string; kind?: EventKind; at?: string | null; status?: 'planned' | 'done' | 'cancelled' }) {
    return this.write<{ id: string }>('/api/events/save', body);
  }

  addAgendaItem(body: { eventId: string; text: string; issueKey?: string | null }) {
    return this.write('/api/events/agenda/add', body);
  }

  updateAgendaItem(body: { id: string; answer?: string | null; status?: 'open' | 'answered' | 'dropped' }) {
    return this.write('/api/events/agenda/update', body);
  }

  saveSettings(body: { title?: string; subtitle?: string; capacityPoints?: number | null; staleAfterDays?: number; boardId?: string | null; jql?: string; timeZone?: string | null }) {
    return this.write('/api/settings', body);
  }

  /** Read from Jira again, one way. Returns a short account of what came in, or the reason it could not. */
  async pull(): Promise<{ ok: boolean; said: string }> {
    try {
      const r = await firstValueFrom(this.http.post<{ added: string[]; changed: string[]; released: string[]; sprints: number }>('/api/jira/pull', {}));
      this.overview.reload();
      const parts = [r.added.length ? `${r.added.length} new` : '', r.changed.length ? `${r.changed.length} changed` : '', r.released.length ? `${r.released.length} no longer yours` : ''];
      return { ok: true, said: parts.filter(Boolean).join(', ') || 'Nothing has changed' };
    } catch (err) {
      const e = err as HttpErrorResponse;
      return { ok: false, said: (e.error as { error?: string } | null)?.error ?? 'The pull did not go through.' };
    }
  }

  reload(): void {
    this.health.reload();
    this.overview.reload();
  }
}

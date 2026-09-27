import { DEFAULT_SETTINGS, deriveOverview, type IssueSnapshot, type SprintSnapshot } from '@battlestation/domain';
import { buildScene, daysBetween, locate } from './bridge-model';
import { describe as describeRef } from './bridge-page';

const issue = (key: string, over: Partial<IssueSnapshot>): IssueSnapshot => ({
  key, url: `https://example.atlassian.net/browse/${key}`, summary: `Summary ${key}`, type: 'Story', subtask: false, status: 'To Do', statusCategory: 'todo', priority: null,
  points: 3, assignee: 'Me', assignedToMe: true, reporter: null, sprintIds: [], parent: null, labels: [], description: '', created: '2026-10-01T09:00:00.000+1000',
  updated: '2026-10-01T09:00:00.000+1000', resolved: null, due: null, started: null, flagged: false, links: [], comments: [], fetchedAt: '', ...over,
});

const sprint = (id: string, state: SprintSnapshot['state'], startDate: string | null, endDate: string | null): SprintSnapshot => ({
  id, name: `Team Sprint ${id}`, state, startDate, endDate, completeDate: state === 'closed' ? endDate : null, goal: '', boardId: '7', fetchedAt: '',
});

/** The smallest overview that has every kind of thing in it. */
function overview() {
  return deriveOverview({
    today: '2026-10-14',
    settings: { ...DEFAULT_SETTINGS, capacityPoints: 10 },
    sprints: [sprint('40', 'closed', '2026-09-21', '2026-10-02'), sprint('41', 'active', '2026-10-05', '2026-10-16'), sprint('42', 'future', null, null)],
    issues: [
      issue('A-1', { sprintIds: ['40'], statusCategory: 'done', status: 'Done', started: '2026-09-22T10:00:00.000+1000', resolved: '2026-09-25T10:00:00.000+1000' }),
      issue('A-2', { sprintIds: ['41'], statusCategory: 'doing', status: 'In Progress', started: '2026-10-12T10:00:00.000+1000', due: '2026-10-15' }),
      issue('A-3', { sprintIds: ['41'], links: [{ key: 'B-1', summary: 'Other', statusCategory: 'todo', direction: 'blocked_by', label: 'is blocked by' }] }),
      issue('A-4', {}),
    ],
    notes: [],
    tasks: [
      { id: 't1', number: 1, title: 'Step', type: 'build', description: '', status: 'doing', blockedBy: '', issueKey: 'A-2', sprintId: '41', order: 1, startedOn: '2026-10-13', doneOn: null, createdAt: '2026-10-13T00:00:00Z', updatedAt: '' },
      { id: 't2', number: 2, title: 'Loose', type: 'build', description: '', status: 'todo', blockedBy: '', issueKey: null, sprintId: null, order: 1, startedOn: null, doneOn: null, createdAt: '2026-10-13T00:00:00Z', updatedAt: '' },
    ],
    events: [{ id: 'e1', number: 1, kind: 'planning', title: 'Planning', at: '2026-10-19T10:00:00+10:00', status: 'planned', notes: '', createdAt: '2026-10-01T00:00:00Z', updatedAt: '' }],
    agendaByEvent: () => [],
    lastPull: null,
  });
}

describe('the scene', () => {
  const o = overview();
  const s = buildScene(o);
  const at = (d: string) => daysBetween(s.origin, d);

  it('lays each sprint out as a zone and a band, and one with no dates after the last', () => {
    expect(s.zones.map((z) => [z.sprintId, z.phase])).toEqual([['40', 'closed'], ['41', 'active'], ['42', 'future']]);
    const band = s.items.find((i) => i.key === 'band-41')!;
    expect(band.shape).toBe('band');
    expect(band.label).toBe('S41  0 of 6');
    const future = s.items.find((i) => i.key === 'band-42')!;
    expect(future.shape).toBe('outline');
    expect(future.start).toBeGreaterThan(at('2026-10-16'));
  });

  it('draws issues where their work is: done in the past, in progress up to today, to do ahead', () => {
    expect(s.items.find((i) => i.key === 'bar-A-1')!.end).toBe(at('2026-09-25') + 1);
    const doing = s.items.find((i) => i.key === 'bar-A-2')!;
    expect([doing.start, doing.end, doing.live]).toEqual([at('2026-10-12'), s.today + 1, true]);
    const todo = s.items.find((i) => i.key === 'bar-A-3')!;
    expect([todo.shape, todo.tone, todo.start]).toEqual(['outline', 'danger', s.today]);
    expect(s.items.find((i) => i.key === 'due-A-2')!.shape).toBe('diamond');
    expect(s.labels.map((l) => l.text)).toContain('A-2  Summary A-2');
  });

  it('has the backlog, meetings and your own work', () => {
    expect(s.items.find((i) => i.key === 'backlog')!.label).toBe('backlog, 1 in no sprint');
    expect(s.items.find((i) => i.key === 'event-e1')!.shape).toBe('flag');
    expect(s.items.find((i) => i.key === 'task-t1')!.label).toContain('T-1');
    expect(s.items.find((i) => i.key === 'unplaced')).toBeTruthy();
  });

  it('finds where a thing is, to fly to it', () => {
    expect(locate(s, { type: 'issue', id: 'A-2' })!.day).toBe(s.today + 1);
    expect(locate(s, { type: 'issue', id: 'nope' })).toBeNull();
  });

  it('says what each kind of thing is', () => {
    expect(describeRef(o, { type: 'sprint', id: '41' })!.kind).toBe('Sprint');
    const i = describeRef(o, { type: 'issue', id: 'A-3' })!;
    expect([i.links[0].badge, i.links[0].ref, i.links[0].href]).toEqual(['B-1', null, null]);
    expect(i.issue!.fresh).toBe(true);
    expect(describeRef(o, { type: 'task', id: 't1' })!.task!.status).toBe('doing');
    expect(describeRef(o, { type: 'event', id: 'e1' })!.meeting!.id).toBe('e1');
    expect(describeRef(o, { type: 'board', id: 'backlog' })!.links.length).toBe(1);
    expect(describeRef(o, { type: 'board', id: 'board' })!.settings).toBe(true);
    expect(describeRef(o, { type: 'issue', id: 'nope' })).toBeNull();
  });
});

/**
 * Sidebar: session list with status badges and polling-based live updates.
 *
 * On init, fetches `/api/sessions` for the current list, then starts a
 * polling loop that re-fetches the list every 3 seconds so the list stays
 * fresh.
 */

interface SidebarSession {
  id: string;
  status: string;
  updatedAt: string;
  planVersions: { version: number }[];
}

export class Sidebar {
  private readonly container: HTMLElement;
  private sessions: SidebarSession[] = [];

  constructor(container: HTMLElement) {
    this.container = container;
  }

  async init(): Promise<void> {
    await this.fetchSessions();
    this.render();
    this.startPolling();
  }

  private async fetchSessions(): Promise<void> {
    try {
      const res = await fetch('/api/sessions');
      if (!res.ok) return;
      const data = (await res.json()) as { sessions: SidebarSession[] };
      this.sessions = data.sessions;
    } catch {
      // Network error — leave current list as-is.
    }
  }

  private startPolling(): void {
    setInterval(() => {
      void this.fetchSessions().then(() => this.render());
    }, 3000);
  }

  private render(): void {
    this.container.replaceChildren();

    const heading = document.createElement('h2');
    heading.textContent = 'Sessions';
    this.container.appendChild(heading);

    if (this.sessions.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'sidebar__empty';
      empty.textContent = 'No sessions yet.';
      this.container.appendChild(empty);
      return;
    }

    const list = document.createElement('ul');
    list.className = 'sidebar__list';
    for (const s of this.sessions) {
      const li = document.createElement('li');
      li.setAttribute('data-session-item', '');
      li.dataset['sessionId'] = s.id;

      const link = document.createElement('a');
      link.href = `/?session=${encodeURIComponent(s.id)}`;
      link.className = 'sidebar__link';

      const idSpan = document.createElement('span');
      idSpan.className = 'sidebar__session-id';
      idSpan.textContent = s.id.slice(0, 8);

      const badge = document.createElement('span');
      badge.className = 'sidebar__badge';
      badge.setAttribute('data-session-status', '');
      badge.dataset['status'] = s.status;
      badge.textContent = s.status;

      const meta = document.createElement('span');
      meta.className = 'sidebar__meta';
      meta.textContent = `v${s.planVersions.length}`;

      link.append(idSpan, badge, meta);
      li.appendChild(link);
      list.appendChild(li);
    }
    this.container.appendChild(list);
  }
}

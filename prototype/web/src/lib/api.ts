type ApiError = { error?: string; detail?: string };

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', ...init });
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const body = (await res.json()) as ApiError & { detail?: string };
      msg = body.detail ?? body.error ?? msg;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  login: (id: string, pw: string) =>
    req<{ id: string; role: string; label: string }>('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, pw }),
    }),
  logout: () => req('/api/logout', { method: 'POST' }),
  me: () => req<{ id: string; role: string; label: string }>('/api/me'),
  participants: () => req<Participant[]>('/api/participants'),
  createParticipant: (p: { name: string; phone: string; email: string; birth_date: string }) =>
    req<Participant>('/api/participants', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(p),
    }),
  participant: (pid: string) => req<ParticipantDetail>(`/api/participants/${pid}`),
  createSession: (s: { participant_id: string; occurred_at: string; kind: string }) =>
    req<Session>('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(s),
    }),
  process: (sid: string, form: FormData) =>
    req<{ masked_text: string; draft: Draft }>(`/api/sessions/${sid}/process`, {
      method: 'POST',
      body: form,
    }),
  approve: (sid: string) =>
    req<{ approved_at: string }>(`/api/sessions/${sid}/approve`, { method: 'POST' }),
};

export interface Participant {
  participant_id: string;
  name: string;
  phone: string;
  email: string;
  birth_date: string;
  created_at: string;
}

export interface Session {
  session_id: string;
  participant_id: string;
  occurred_at: string;
  kind: string;
  masked_text: string;
  draft_json: string;
  approved_at: string;
  author: string;
  draft?: Draft | null;
}

export interface Draft {
  one_liner: string;
  claims: { goal_discussions: string[]; other_topics: string[]; promises: string[] };
  questions: { title: string; reason: string; evidence: string }[];
  flag_suggestions: { flag_type: string; quote: string }[];
}

export interface ParticipantDetail extends Participant {
  sessions: Session[];
}

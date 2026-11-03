import { reactive } from 'vue';

import { api } from '../api/client.ts';
import type { Me } from '../api/types.ts';

export const session = reactive<{ me: Me | null; loaded: boolean }>({ me: null, loaded: false });

export async function loadSession(): Promise<void> {
  try {
    session.me = await api.get<Me>('/api/v1/me');
  } catch {
    session.me = null;
  } finally {
    session.loaded = true;
  }
}

export function clearSession(): void {
  session.me = null;
  session.loaded = true;
}

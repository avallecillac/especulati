/** Device-local choice between generated covers and TMDB posters (openspec add-cinefilo-themes, D5). Never synced. */
import { COVERS_KEY } from '../theme/frozen.ts';

export type CoversMode = 'generated' | 'posters';

function readStored(): CoversMode {
  try {
    return localStorage.getItem(COVERS_KEY) === 'posters' ? 'posters' : 'generated';
  } catch {
    return 'generated';
  }
}

export const covers = $state<{ mode: CoversMode }>({ mode: readStored() });

export function setCovers(mode: CoversMode): void {
  covers.mode = mode === 'posters' ? 'posters' : 'generated';
  try {
    if (covers.mode === 'generated') localStorage.removeItem(COVERS_KEY);
    else localStorage.setItem(COVERS_KEY, covers.mode);
  } catch {
    // blocked storage: the choice lasts for this session only
  }
}

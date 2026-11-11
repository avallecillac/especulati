/** Device-local choice between TMDB posters (default) and generated covers (openspec posters-by-default). Never synced. */
import { COVERS_KEY } from '../theme/frozen.ts';

export type CoversMode = 'generated' | 'posters';

function readStored(): CoversMode {
  try {
    return localStorage.getItem(COVERS_KEY) === 'generated' ? 'generated' : 'posters';
  } catch {
    return 'posters';
  }
}

export const covers = $state<{ mode: CoversMode }>({ mode: readStored() });

export function setCovers(mode: CoversMode): void {
  covers.mode = mode === 'generated' ? 'generated' : 'posters';
  try {
    if (covers.mode === 'posters') localStorage.removeItem(COVERS_KEY);
    else localStorage.setItem(COVERS_KEY, covers.mode);
  } catch {
    // blocked storage: the choice lasts for this session only
  }
}

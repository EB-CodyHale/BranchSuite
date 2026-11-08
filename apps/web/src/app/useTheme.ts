import type { Theme } from '@branchsuite/shared';
import { useCallback, useEffect } from 'react';
import { errorMessage } from '../lib/api.js';
import { useUpdatePreferences } from '../lib/queries.js';
import { useToast } from '../ui/Toast.js';
import { useMeContext } from './MeContext.js';
import { applyTheme } from './theme.js';

/** The signed-in user's theme. Changing it applies instantly and saves to preferences. */
export function useTheme(): { theme: Theme; setTheme: (theme: Theme) => void } {
  const { me } = useMeContext();
  const { mutate } = useUpdatePreferences();
  const { toast } = useToast();
  const theme = me.user.preferences.theme;

  useEffect(() => applyTheme(theme), [theme]);

  const setTheme = useCallback(
    (next: Theme) => {
      applyTheme(next);
      mutate({ theme: next }, { onError: (e) => toast({ tone: 'danger', title: 'Theme not saved', description: errorMessage(e) }) });
    },
    [mutate, toast],
  );
  return { theme, setTheme };
}

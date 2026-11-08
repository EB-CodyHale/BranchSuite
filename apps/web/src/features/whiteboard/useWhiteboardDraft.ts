/**
 * Editor state for one branch + day: a local draft, autosaved as a whole-board PUT after the manager
 * pauses typing (debounced). The server copy is adopted when it changes underneath us (another
 * manager, realtime) and we have nothing unsaved; a 409 refetches, adopts the server copy and notifies.
 */
import { whiteboardPaths, type WhiteboardResponse } from '@branchsuite/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage, isApiError } from '../../lib/api.js';
import { afterWhiteboardWrite, keys } from '../../lib/queries.js';
import { draftOf, toUpsertInput, type WhiteboardDraft } from './model.js';

export const AUTOSAVE_DEBOUNCE_MS = 800;

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error';

export interface WhiteboardDraftApi {
  draft: WhiteboardDraft | null;
  status: SaveStatus;
  error: string | null;
  /** Apply an edit; schedules an autosave. */
  update: (fn: (d: WhiteboardDraft) => WhiteboardDraft) => void;
  /** Save now (cancels the debounce). Resolves with the server response, or null when the save failed. */
  flush: () => Promise<WhiteboardResponse | null>;
  /** Replace the draft with a server copy (copy-from, task link) without saving it again. */
  adopt: (res: WhiteboardResponse) => void;
}

export function useWhiteboardDraft(opts: {
  branchId: string;
  date: string;
  server: WhiteboardResponse | undefined;
  onConflict: () => void;
  enabled: boolean;
}): WhiteboardDraftApi {
  const { branchId, date, server, enabled } = opts;
  const qc = useQueryClient();
  const [draft, setDraft] = useState<WhiteboardDraft | null>(null);
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [error, setError] = useState<string | null>(null);

  const draftRef = useRef<WhiteboardDraft | null>(null);
  const known = useRef<string | null | undefined>(undefined);
  const editSeq = useRef(0);
  const savedSeq = useRef(0);
  const saving = useRef<Promise<WhiteboardResponse | null> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onConflictRef = useRef(opts.onConflict);
  onConflictRef.current = opts.onConflict;

  const setBoth = (d: WhiteboardDraft) => {
    draftRef.current = d;
    setDraft(d);
  };

  // Adopt the server copy on first load, and later when it changed elsewhere while we are clean.
  useEffect(() => {
    if (!server) return;
    const stamp = server.whiteboard?.updatedAt ?? null;
    const clean = editSeq.current === savedSeq.current && saving.current === null;
    if (draftRef.current === null || (clean && stamp !== known.current)) {
      known.current = stamp;
      setBoth(draftOf(server.whiteboard));
    }
  }, [server]);

  const save = useCallback(async (): Promise<WhiteboardResponse | null> => {
    clearTimeout(timer.current);
    // One save at a time; once it lands, save again only if more edits arrived meanwhile.
    if (saving.current) await saving.current;
    const cached = qc.getQueryData<WhiteboardResponse>(keys.whiteboard(branchId, date));
    if (editSeq.current === savedSeq.current && cached?.whiteboard) return cached;
    const current = draftRef.current;
    if (!current) return null;
    const seq = editSeq.current;
    setStatus('saving');
    setError(null);
    const run = (async () => {
      try {
        const res = await api.put<WhiteboardResponse>(whiteboardPaths.board(branchId, date), toUpsertInput(current));
        known.current = res.whiteboard?.updatedAt ?? null;
        savedSeq.current = Math.max(savedSeq.current, seq);
        afterWhiteboardWrite(qc, branchId, date, res);
        return res;
      } catch (e) {
        if (isApiError(e, 'conflict')) {
          const fresh = await qc.fetchQuery({
            queryKey: keys.whiteboard(branchId, date),
            queryFn: () => api.get<WhiteboardResponse>(whiteboardPaths.board(branchId, date)),
            staleTime: 0,
          });
          known.current = fresh.whiteboard?.updatedAt ?? null;
          editSeq.current += 1;
          savedSeq.current = editSeq.current;
          setBoth(draftOf(fresh.whiteboard));
          onConflictRef.current();
          return fresh;
        }
        setError(errorMessage(e));
        return null;
      }
    })();
    saving.current = run;
    const res = await run;
    if (saving.current === run) saving.current = null;
    if (res === null) setStatus('error');
    else if (editSeq.current !== savedSeq.current) {
      setStatus('dirty');
      timer.current = setTimeout(() => void save(), AUTOSAVE_DEBOUNCE_MS);
    } else setStatus('saved');
    return res;
  }, [branchId, date, qc]);

  const saveRef = useRef(save);
  saveRef.current = save;

  const update = useCallback(
    (fn: (d: WhiteboardDraft) => WhiteboardDraft) => {
      if (!enabled || !draftRef.current) return;
      setBoth(fn(draftRef.current));
      editSeq.current += 1;
      setStatus((s) => (s === 'saving' ? s : 'dirty'));
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void saveRef.current(), AUTOSAVE_DEBOUNCE_MS);
    },
    [enabled],
  );

  const flush = useCallback(() => saveRef.current(), []);

  const adopt = useCallback((res: WhiteboardResponse) => {
    known.current = res.whiteboard?.updatedAt ?? null;
    setBoth(draftOf(res.whiteboard));
    editSeq.current += 1;
    savedSeq.current = editSeq.current;
    clearTimeout(timer.current);
    setStatus('saved');
  }, []);

  // Leaving the day (or the page) with unsaved edits: save them on the way out.
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (editSeq.current !== savedSeq.current && draftRef.current) {
        void api.put<WhiteboardResponse>(whiteboardPaths.board(branchId, date), toUpsertInput(draftRef.current)).then(
          (res) => afterWhiteboardWrite(qc, branchId, date, res),
          () => undefined,
        );
      }
    },
    [branchId, date, qc],
  );

  return { draft, status, error, update, flush, adopt };
}

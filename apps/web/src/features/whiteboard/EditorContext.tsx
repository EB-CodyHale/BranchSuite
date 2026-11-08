import type { AccountLite, Order, PersonLite, WhiteboardBlock } from '@branchsuite/shared';
import { createContext, useContext } from 'react';
import type { WhiteboardDraft } from './model.js';

/** What block editors need from the page: roster, orders, and actions that talk to the API. */
export interface WhiteboardEditorEnv {
  branchId: string;
  date: string;
  /** Active people of the branch (assignment picker). */
  people: PersonLite[];
  /** Orders that can be prioritised (active orders of the branch). */
  orders: Order[];
  ordersById: Map<string, Order>;
  accountsById: Map<string, AccountLite>;
  orderLabels: WhiteboardDraft['orderLabels'];
  setOrderLabels: (v: WhiteboardDraft['orderLabels']) => void;
  /** Saves pending edits, then creates and links an inbox task for the assignment item. */
  createTask: (itemId: string) => Promise<void>;
  creatingTaskFor: string | null;
  /** Upload an image file for an image block; resolves with the media id or throws a friendly Error. */
  upload: (file: File, signal: AbortSignal) => Promise<{ id: string; width: number | null; height: number | null }>;
  /** URL to fetch an uploaded image for preview (staff media route). */
  mediaUrl: (mediaId: string) => string;
}

export const EditorEnvContext = createContext<WhiteboardEditorEnv | null>(null);

export function useEditorEnv(): WhiteboardEditorEnv {
  const ctx = useContext(EditorEnvContext);
  if (!ctx) throw new Error('Whiteboard block editors must be rendered inside EditorEnvContext.');
  return ctx;
}

export type BlockOf<K extends WhiteboardBlock['kind']> = Extract<WhiteboardBlock, { kind: K }>;

export interface BlockEditorProps<K extends WhiteboardBlock['kind']> {
  block: BlockOf<K>;
  onChange: (next: BlockOf<K>) => void;
}

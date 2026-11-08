import { ClipboardPaste, ImagePlus, RefreshCw } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { errorMessage } from '../../lib/api.js';
import { Button } from '../../ui/Button.js';
import { cx } from '../../ui/cx.js';
import { TextField } from '../../ui/Field.js';
import { KeyboardShortcut } from '../../ui/Kbd.js';
import { useEditorEnv, type BlockEditorProps } from './EditorContext.js';
import { MediaImage } from './media.js';
import { formatBytes, imageFromTransfer, validateImageFile } from './model.js';

type UploadState = { status: 'idle' } | { status: 'uploading'; name: string; bytes: number } | { status: 'error'; message: string };

/**
 * Graph / screenshot block: drop a file, pick one, or paste a screenshot (Ctrl+V) while the drop zone
 * or anything in this block has focus. The file is checked here first (type, 8 MB), then uploaded.
 */
export function ImageBlockEditor({
  block,
  onChange,
  pastedFile,
  onPastedFileTaken,
}: BlockEditorProps<'image'> & { pastedFile?: File | null; onPastedFileTaken?: () => void }) {
  const env = useEditorEnv();
  const [upload, setUpload] = useState<UploadState>({ status: 'idle' });
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const blockRef = useRef(block);
  blockRef.current = block;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const hintId = useId();

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(
    () => () => {
      if (localPreview) URL.revokeObjectURL(localPreview);
    },
    [localPreview],
  );

  const start = async (file: File) => {
    const problem = validateImageFile(file);
    if (problem) {
      setUpload({ status: 'error', message: problem });
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setUpload({ status: 'uploading', name: file.name || 'Pasted screenshot', bytes: file.size });
    try {
      const media = await env.upload(file, ctrl.signal);
      if (ctrl.signal.aborted) return;
      setLocalPreview(typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null);
      setUpload({ status: 'idle' });
      onChangeRef.current({ ...blockRef.current, mediaId: media.id });
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setUpload({ status: 'error', message: errorMessage(e) });
    }
  };
  const startRef = useRef(start);
  startRef.current = start;

  // A screenshot pasted elsewhere in the editor that created this block.
  const takenRef = useRef(onPastedFileTaken);
  takenRef.current = onPastedFileTaken;
  useEffect(() => {
    if (!pastedFile) return;
    takenRef.current?.();
    void startRef.current(pastedFile);
  }, [pastedFile]);

  const onPaste = (e: ClipboardEvent) => {
    const file = imageFromTransfer(e.clipboardData);
    if (!file) return;
    e.preventDefault();
    e.stopPropagation();
    void start(file);
  };
  const onDrop = (e: DragEvent) => {
    const file = imageFromTransfer(e.dataTransfer);
    if (!file) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    void start(file);
  };

  const hasImage = block.mediaId !== '';
  const busy = upload.status === 'uploading';

  return (
    <div className="flex flex-col gap-2" onPaste={onPaste}>
      <div
        role="group"
        tabIndex={0}
        aria-label={hasImage ? 'Image. Drop, paste or choose a file to replace it' : 'Add an image. Drop a file here, paste a screenshot, or choose a file'}
        aria-describedby={hintId}
        aria-busy={busy || undefined}
        onDragOver={(e) => {
          if (Array.from(e.dataTransfer?.types ?? []).includes('Files')) {
            e.preventDefault();
            setDragOver(true);
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={cx(
          'relative flex min-h-36 flex-col items-center justify-center gap-2 overflow-hidden rounded-lg border-2 border-dashed p-3 text-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
          dragOver ? 'border-accent bg-accent-soft' : 'border-line-strong bg-surface-2/60',
        )}
      >
        {hasImage ? (
          <div className="h-48 w-full">
            {localPreview ? (
              <img src={localPreview} alt={block.caption || block.title || 'Uploaded image'} className="h-full w-full object-contain" />
            ) : (
              <MediaImage url={env.mediaUrl(block.mediaId)} alt={block.caption || block.title || 'Uploaded image'} />
            )}
          </div>
        ) : (
          <>
            <ImagePlus aria-hidden="true" className="size-8 text-muted" />
            <p className="font-semibold">Drop a graph or screenshot here</p>
          </>
        )}
        <p id={hintId} className="flex flex-wrap items-center justify-center gap-1 text-sm text-muted">
          <ClipboardPaste aria-hidden="true" className="size-4" />
          Paste with <KeyboardShortcut keys={['Ctrl', 'V']} /> · PNG, JPEG or WebP up to {formatBytes(8 * 1024 * 1024)}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button size="sm" icon={hasImage ? <RefreshCw aria-hidden="true" className="size-4" /> : <ImagePlus aria-hidden="true" className="size-4" />} onClick={() => inputRef.current?.click()} disabled={busy}>
            {hasImage ? 'Replace image' : 'Choose file'}
          </Button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void start(file);
          }}
        />
        {busy ? (
          <div className="absolute inset-x-3 bottom-2 flex flex-col gap-1" role="status">
            <span className="text-xs font-semibold">
              Uploading {upload.name} ({formatBytes(upload.bytes)})…
            </span>
            <progress aria-label="Upload progress" className="h-1.5 w-full accent-accent" />
          </div>
        ) : null}
      </div>
      {upload.status === 'error' ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {upload.message}
        </p>
      ) : null}
      <TextField label="Caption" placeholder="e.g. Fill rate this week" maxLength={200} value={block.caption} onChange={(e) => onChange({ ...block, caption: e.target.value })} />
    </div>
  );
}

/**
 * Whiteboard images are never public URLs: staff fetch them with their session, displays with their
 * display token. <img> cannot send headers, so every image is fetched as a Blob and shown through an
 * object URL, which is revoked when the source changes or the component unmounts.
 *
 * Kept free of the staff query layer so the wall chunk can use it.
 */
import { ImageOff } from 'lucide-react';
import { createContext, useContext, useEffect, useState } from 'react';
import { cx } from '../../ui/cx.js';

/** Fetch an image as a Blob. Staff and display callers each supply their own authenticated loader. */
export type MediaLoader = (url: string, signal: AbortSignal) => Promise<Blob>;

export const MediaLoaderContext = createContext<MediaLoader | null>(null);

export type MediaState = { status: 'loading'; src: null } | { status: 'ready'; src: string } | { status: 'error'; src: null };

export function useMediaObjectUrl(url: string | null, loader: MediaLoader | null): MediaState {
  const [state, setState] = useState<MediaState>({ status: 'loading', src: null });
  useEffect(() => {
    if (!url || !loader) {
      setState({ status: url ? 'loading' : 'error', src: null });
      return;
    }
    const ctrl = new AbortController();
    let objectUrl: string | null = null;
    setState({ status: 'loading', src: null });
    loader(url, ctrl.signal).then(
      (blob) => {
        if (ctrl.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ status: 'ready', src: objectUrl });
      },
      () => {
        if (!ctrl.signal.aborted) setState({ status: 'error', src: null });
      },
    );
    return () => {
      ctrl.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, loader]);
  return state;
}

export interface MediaImageProps {
  url: string;
  alt: string;
  className?: string;
  /** Skip fetching (hidden measuring layers). */
  placeholderOnly?: boolean;
}

/** An image fetched through the MediaLoader in context, fit with object-contain. */
export function MediaImage({ url, alt, className, placeholderOnly }: MediaImageProps) {
  const loader = useContext(MediaLoaderContext);
  const media = useMediaObjectUrl(placeholderOnly ? null : url, loader);
  if (media.status === 'ready') return <img src={media.src} alt={alt} className={cx('h-full w-full object-contain', className)} draggable={false} />;
  return (
    <div
      role={media.status === 'error' ? 'img' : 'status'}
      aria-label={media.status === 'error' ? `${alt} (image unavailable)` : `Loading ${alt}`}
      className={cx('grid h-full w-full place-items-center rounded-[0.3em] bg-surface-2 text-muted', className)}
    >
      {media.status === 'error' ? <ImageOff aria-hidden="true" className="size-[2em]" /> : <span aria-hidden="true" className="size-[1.2em] animate-pulse-soft rounded-full bg-line-strong" />}
    </div>
  );
}

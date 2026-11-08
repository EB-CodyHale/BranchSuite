import type { Order } from '@branchsuite/shared';
import { CirclePause, CirclePlay, History, ListPlus, MoreHorizontal, PencilLine, Send, XCircle } from 'lucide-react';
import { cx } from '../../ui/cx.js';
import { Menu, MenuItem, MenuSeparator } from '../../ui/Menu.js';
import { useBoardActions } from './BoardContext.js';

export interface OrderMenuProps {
  order: Order;
  /** Name used in the menu label, e.g. the account name. */
  title: string;
  canManage: boolean;
  className?: string;
}

/** Per-order actions. Members see History only; managers get edit, openings, pause/resume, close, publish. */
export function OrderMenu({ order, title, canManage, className }: OrderMenuProps) {
  const actions = useBoardActions();
  return (
    <Menu
      label={`Actions for ${title}`}
      trigger={(props) => (
        <button
          {...props}
          type="button"
          aria-label={`Order actions: ${title}`}
          title="Order actions"
          className={cx('inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg', className)}
        >
          <MoreHorizontal aria-hidden="true" className="size-[1.1rem]" />
        </button>
      )}
    >
      {canManage ? (
        <>
          {order.status === 'draft' ? (
            <MenuItem icon={<Send />} onSelect={() => actions.publish(order)}>
              Publish
            </MenuItem>
          ) : null}
          <MenuItem icon={<PencilLine />} onSelect={() => actions.open('edit', order)}>
            Edit order
          </MenuItem>
          <MenuItem icon={<ListPlus />} onSelect={() => actions.open('addOpenings', order)}>
            Add openings
          </MenuItem>
          {order.status === 'active' ? (
            <MenuItem icon={<CirclePause />} onSelect={() => actions.open('pause', order)}>
              Pause
            </MenuItem>
          ) : null}
          {order.status === 'paused' ? (
            <MenuItem icon={<CirclePlay />} onSelect={() => actions.resume(order)}>
              Resume
            </MenuItem>
          ) : null}
          <MenuItem icon={<XCircle />} tone="danger" onSelect={() => actions.open('close', order)}>
            Close order
          </MenuItem>
          <MenuSeparator />
        </>
      ) : null}
      <MenuItem icon={<History />} onSelect={() => actions.open('history', order)}>
        History
      </MenuItem>
    </Menu>
  );
}

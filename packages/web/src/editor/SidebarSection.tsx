import type { ReactNode } from 'react';
import { Button } from 'antd';
import { CaretRightOutlined, PlusOutlined } from '@ant-design/icons';

/** 侧栏可折叠分区（左资源栏 / 右检查器共用） */
export function SidebarSection({
  title,
  open,
  onToggle,
  actionLabel,
  onAction,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  actionLabel?: string;
  onAction?: () => void;
  children: ReactNode;
}) {
  return (
    <section className={`sidebar-section${open ? ' is-open' : ''}`}>
      <header className="sidebar-section-header" onClick={onToggle}>
        <CaretRightOutlined className="sidebar-section-caret" rotate={open ? 90 : 0} />
        <span className="sidebar-section-title">{title}</span>
        {actionLabel && onAction ? (
          <Button
            type="link"
            size="small"
            className="collapse-header-action"
            icon={<PlusOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              if (!open) {
                onToggle();
              }
              onAction();
            }}
          >
            {actionLabel}
          </Button>
        ) : null}
      </header>
      <div className="sidebar-section-body">{children}</div>
    </section>
  );
}

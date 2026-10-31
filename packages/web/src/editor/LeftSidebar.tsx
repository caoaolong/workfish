import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Flex, Typography } from 'antd';
import { CaretRightOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import type { EnvironmentCatalog } from '@workfish/spec';
import type { NodeCatalogItem } from '../types.js';
import { EnvPanel, type EnvPanelHandle } from './EnvPanel.js';
import { NodePalette } from './NodePalette.js';

type Props = {
  ready: NodeCatalogItem[];
  problems: NodeCatalogItem[];
  environments: EnvironmentCatalog;
  onRefresh: () => void;
  refreshing: boolean;
  onEnvironmentsChanged: (next: EnvironmentCatalog) => Promise<void> | void;
};

type SectionKey = 'nodes' | 'envs';

function SidebarSection({
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

export function LeftSidebar({
  ready,
  problems,
  environments,
  onRefresh,
  refreshing,
  onEnvironmentsChanged,
}: Props) {
  const envPanelRef = useRef<EnvPanelHandle>(null);
  const [openKeys, setOpenKeys] = useState<SectionKey[]>(['nodes', 'envs']);

  const toggle = (key: SectionKey) => {
    setOpenKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  return (
    <aside className="editor-sidebar editor-sidebar-left">
      <Flex align="center" justify="space-between" className="sidebar-toolbar">
        <Typography.Title level={5} style={{ margin: 0 }}>
          资源
        </Typography.Title>
        <Button
          size="small"
          icon={<ReloadOutlined />}
          loading={refreshing}
          onClick={onRefresh}
        >
          刷新
        </Button>
      </Flex>

      <div className="left-sidebar-sections">
        <SidebarSection
          title={`节点（${ready.length}）`}
          open={openKeys.includes('nodes')}
          onToggle={() => toggle('nodes')}
        >
          <NodePalette ready={ready} problems={problems} />
        </SidebarSection>

        <SidebarSection
          title={`环境（${environments.items.length}）`}
          open={openKeys.includes('envs')}
          onToggle={() => toggle('envs')}
          actionLabel="新建"
          onAction={() => envPanelRef.current?.openCreateEnv()}
        >
          <EnvPanel
            ref={envPanelRef}
            catalog={environments}
            onChanged={onEnvironmentsChanged}
          />
        </SidebarSection>
      </div>
    </aside>
  );
}

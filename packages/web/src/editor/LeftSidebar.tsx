import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Flex, Typography } from 'antd';
import { CaretRightOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import type { EnvironmentCatalog, TypeDef } from '@workfish/spec';
import type { NodeCatalogItem } from '../types.js';
import { EnvPanel, type EnvPanelHandle } from './EnvPanel.js';
import { NodePalette } from './NodePalette.js';
import { TypePanel, type TypePanelHandle } from './TypePanel.js';

type Props = {
  ready: NodeCatalogItem[];
  problems: NodeCatalogItem[];
  types: TypeDef[];
  environments: EnvironmentCatalog;
  onRefresh: () => void;
  refreshing: boolean;
  onTypesChanged: () => Promise<void> | void;
  onEnvironmentsChanged: (next: EnvironmentCatalog) => Promise<void> | void;
};

type SectionKey = 'nodes' | 'types' | 'envs';

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
  types,
  environments,
  onRefresh,
  refreshing,
  onTypesChanged,
  onEnvironmentsChanged,
}: Props) {
  const typePanelRef = useRef<TypePanelHandle>(null);
  const envPanelRef = useRef<EnvPanelHandle>(null);
  const [openKeys, setOpenKeys] = useState<SectionKey[]>(['nodes', 'types', 'envs']);

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
          title={`数据结构（${types.length}）`}
          open={openKeys.includes('types')}
          onToggle={() => toggle('types')}
          actionLabel="新建"
          onAction={() => typePanelRef.current?.openCreate()}
        >
          <TypePanel ref={typePanelRef} types={types} onChanged={onTypesChanged} />
        </SidebarSection>

        <SidebarSection
          title={`环境（${environments.items.length}）`}
          open={openKeys.includes('envs')}
          onToggle={() => toggle('envs')}
          actionLabel="新建"
          onAction={() => envPanelRef.current?.openCreateGroup()}
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

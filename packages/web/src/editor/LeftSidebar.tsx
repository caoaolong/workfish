import { useRef, useState } from 'react';
import { Button, Flex, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import type { EnvironmentCatalog } from '@workfish/spec';
import type { NodeCatalogItem } from '../types.js';
import { EnvPanel, type EnvPanelHandle } from './EnvPanel.js';
import { NodePalette } from './NodePalette.js';
import { SidebarSection } from './SidebarSection.js';

type Props = {
  ready: NodeCatalogItem[];
  problems: NodeCatalogItem[];
  environments: EnvironmentCatalog;
  onRefresh: () => void;
  refreshing: boolean;
  onEnvironmentsChanged: (next: EnvironmentCatalog) => Promise<void> | void;
};

type SectionKey = 'nodes' | 'envs';

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

      <div className="sidebar-sections">
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

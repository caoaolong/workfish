import { forwardRef, useImperativeHandle, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Empty, Space, Tree, Typography, App as AntdApp } from 'antd';
import type { DataNode } from 'antd/es/tree';
import { DeleteOutlined, EditOutlined } from '@ant-design/icons';
import type { FieldSpec, TypeDef } from '@workfish/spec';
import { deleteType, formatApiError, putType } from '../api/client.js';
import { TypeEditorModal } from './TypeEditorModal.js';

export type TypePanelHandle = {
  openCreate: () => void;
};

type Props = {
  types: TypeDef[];
  onChanged: () => Promise<void> | void;
};

function fieldSummary(field: FieldSpec): string {
  if (field.type === 'ref' && field.ref) {
    return `ref:${field.ref}`;
  }
  if (field.type === 'array' && field.items) {
    return `array<${fieldSummary(field.items)}>`;
  }
  return field.type;
}

function TreeTitle({
  label,
  hint,
  actions,
}: {
  label: ReactNode;
  hint?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="sidebar-tree-title">
      <div className="sidebar-tree-title-main">
        <Typography.Text ellipsis style={{ maxWidth: '100%' }}>
          {label}
        </Typography.Text>
        {hint ? (
          <Typography.Text type="secondary" className="sidebar-tree-hint">
            {hint}
          </Typography.Text>
        ) : null}
      </div>
      {actions ? <Space size={0} className="sidebar-tree-actions">{actions}</Space> : null}
    </div>
  );
}

export const TypePanel = forwardRef<TypePanelHandle, Props>(function TypePanel(
  { types, onChanged },
  ref,
) {
  const { message, modal } = AntdApp.useApp();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<TypeDef | null>(null);

  const openCreate = () => {
    setEditing(null);
    setEditorOpen(true);
  };

  useImperativeHandle(ref, () => ({ openCreate }), []);

  const openEdit = (def: TypeDef) => {
    setEditing(def);
    setEditorOpen(true);
  };

  const handleSave = async (def: TypeDef) => {
    try {
      await putType(def.id, def);
      message.success(editing ? '已更新数据结构' : '已创建数据结构');
      setEditorOpen(false);
      await onChanged();
    } catch (e) {
      throw new Error(formatApiError(e));
    }
  };

  const handleDelete = (def: TypeDef) => {
    modal.confirm({
      title: '删除数据结构',
      content: `确定删除「${def.name}」（${def.id}）吗？引用该类型的节点可能校验失败。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteType(def.id);
          message.success('已删除');
          await onChanged();
        } catch (e) {
          message.error(formatApiError(e));
          throw e;
        }
      },
    });
  };

  const treeData: DataNode[] = types.map((item) => {
    const fieldEntries = Object.entries(item.fields);
    return {
      key: `type:${item.id}`,
      title: (
        <TreeTitle
          label={<Typography.Text strong>{item.name}</Typography.Text>}
          hint={item.id}
          actions={
            <>
              <Button
                type="text"
                size="small"
                icon={<EditOutlined />}
                onClick={(e) => {
                  e.stopPropagation();
                  openEdit(item);
                }}
              />
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(item);
                }}
              />
            </>
          }
        />
      ),
      children:
        fieldEntries.length === 0
          ? [
              {
                key: `type:${item.id}:empty`,
                isLeaf: true,
                selectable: false,
                title: (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    无字段
                  </Typography.Text>
                ),
              },
            ]
          : fieldEntries.map(([name, field]) => ({
              key: `type:${item.id}:field:${name}`,
              isLeaf: true,
              selectable: false,
              title: (
                <TreeTitle
                  label={
                    <>
                      <Typography.Text>{name}</Typography.Text>
                      {field.optional ? (
                        <Typography.Text type="secondary">?</Typography.Text>
                      ) : null}
                    </>
                  }
                  hint={fieldSummary(field)}
                />
              ),
            })),
    };
  });

  return (
    <div className="sidebar-panel-body">
      {types.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据结构" />
      ) : (
        <Tree
          key={types.map((t) => t.id).join('|')}
          className="sidebar-tree"
          blockNode
          defaultExpandAll
          selectable={false}
          treeData={treeData}
        />
      )}

      <TypeEditorModal
        open={editorOpen}
        initial={editing}
        existingIds={types.map((t) => t.id)}
        typeOptions={types}
        onCancel={() => setEditorOpen(false)}
        onSave={handleSave}
      />
    </div>
  );
});

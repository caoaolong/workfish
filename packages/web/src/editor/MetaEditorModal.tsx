import { useEffect, useState } from 'react';
import { Button, Flex, Form, Input, Modal, Select, Space, Switch, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import type { EnvRequirement, FieldSpec, NodeSpec } from '@workfish/spec';

const FIELD_TYPES: FieldSpec['type'][] = [
  'string',
  'number',
  'boolean',
  'null',
  'any',
  'array',
  'object',
];

type FieldRow = {
  key: string;
  name: string;
  type: FieldSpec['type'];
  optional: boolean;
  description: string;
  itemsType: FieldSpec['type'];
  propertiesText: string;
};

type SlotRow = {
  key: string;
  slotKey: string;
  name: string;
  description: string;
};

type Props = {
  open: boolean;
  initial: NodeSpec | null;
  onCancel: () => void;
  onSave: (meta: NodeSpec) => Promise<void>;
};

function newRowKey(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`;
}

function toFieldRows(fields: Record<string, FieldSpec>): FieldRow[] {
  return Object.entries(fields).map(([name, field], i) => ({
    key: `${name}-${i}`,
    name,
    type: field.type,
    optional: Boolean(field.optional),
    description: field.description ?? '',
    itemsType: field.items?.type ?? 'string',
    propertiesText: field.properties ? JSON.stringify(field.properties, null, 2) : '',
  }));
}

function toSlotRows(slots: EnvRequirement[] | undefined): SlotRow[] {
  return (slots ?? []).map((s, i) => ({
    key: `${s.key}-${i}`,
    slotKey: s.key,
    name: s.name,
    description: s.description ?? '',
  }));
}

function RowListHeader({ title, onAdd }: { title: string; onAdd: () => void }) {
  return (
    <Flex justify="space-between" style={{ width: '100%' }}>
      <span>{title}</span>
      <Button type="link" size="small" icon={<PlusOutlined />} onClick={onAdd}>
        添加
      </Button>
    </Flex>
  );
}

export function MetaEditorModal({ open, initial, onCancel, onSave }: Props) {
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [version, setVersion] = useState('');
  const [description, setDescription] = useState('');
  const [inputRows, setInputRows] = useState<FieldRow[]>([]);
  const [outputRows, setOutputRows] = useState<FieldRow[]>([]);
  const [slotRows, setSlotRows] = useState<SlotRow[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setSaving(false);
    setFormError(null);
    if (initial) {
      setName(initial.name);
      setVersion(initial.version);
      setDescription(initial.description ?? '');
      setInputRows(toFieldRows(initial.inputs));
      setOutputRows(toFieldRows(initial.outputs));
      setSlotRows(toSlotRows(initial.environments));
    }
  }, [open, initial]);

  const patchRow = (
    setter: React.Dispatch<React.SetStateAction<FieldRow[]>>,
    key: string,
    patch: Partial<FieldRow>,
  ) => {
    setter((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const buildFields = (rows: FieldRow[], label: string): Record<string, FieldSpec> | null => {
    const fields: Record<string, FieldSpec> = {};
    const seen = new Set<string>();
    for (const row of rows) {
      const fieldName = row.name.trim();
      if (!fieldName) {
        continue;
      }
      if (seen.has(fieldName)) {
        setFormError(`${label}中字段名「${fieldName}」重复`);
        return null;
      }
      seen.add(fieldName);
      const field: FieldSpec = {
        type: row.type,
        ...(row.optional ? { optional: true as const } : {}),
        ...(row.description.trim() ? { description: row.description.trim() } : {}),
      };
      if (row.type === 'array') {
        field.items = { type: row.itemsType };
      }
      if (row.type === 'object') {
        if (row.propertiesText.trim()) {
          try {
            const parsed = JSON.parse(row.propertiesText) as unknown;
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
              setFormError(`${label}字段「${fieldName}」的 properties 必须是对象`);
              return null;
            }
            field.properties = parsed as Record<string, FieldSpec>;
          } catch {
            setFormError(`${label}字段「${fieldName}」的 properties 不是合法 JSON`);
            return null;
          }
        } else {
          field.properties = {};
        }
      }
      fields[fieldName] = field;
    }
    return fields;
  };

  const handleOk = async () => {
    if (!initial) {
      return;
    }
    setFormError(null);
    if (!name.trim()) {
      setFormError('请填写脚本名称');
      return;
    }
    if (!version.trim()) {
      setFormError('请填写版本号');
      return;
    }
    const inputs = buildFields(inputRows, '输入');
    if (!inputs) {
      return;
    }
    const outputs = buildFields(outputRows, '输出');
    if (!outputs) {
      return;
    }
    const seenSlots = new Set<string>();
    const slots: EnvRequirement[] = [];
    for (const row of slotRows) {
      const key = row.slotKey.trim();
      if (!key) {
        continue;
      }
      if (seenSlots.has(key)) {
        setFormError(`环境槽位 key「${key}」重复`);
        return;
      }
      seenSlots.add(key);
      if (!row.name.trim()) {
        setFormError(`环境槽位「${key}」请填写名称`);
        return;
      }
      slots.push({
        key,
        name: row.name.trim(),
        ...(row.description.trim() ? { description: row.description.trim() } : {}),
      });
    }
    const meta: NodeSpec = {
      id: initial.id,
      name: name.trim(),
      version: version.trim(),
      inputs,
      outputs,
    };
    if (description.trim()) {
      meta.description = description.trim();
    }
    if (slots.length > 0) {
      meta.environments = slots;
    }
    setSaving(true);
    try {
      await onSave(meta);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const renderFieldRows = (
    rows: FieldRow[],
    setter: React.Dispatch<React.SetStateAction<FieldRow[]>>,
  ) => (
    <Space direction="vertical" style={{ width: '100%' }} size="small">
      {rows.map((row) => (
        <div
          key={row.key}
          style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 8 }}
        >
          <Flex gap={8} style={{ marginBottom: 8 }}>
            <Input
              placeholder="字段名（camelCase）"
              value={row.name}
              onChange={(e) => patchRow(setter, row.key, { name: e.target.value })}
              style={{ flex: 1 }}
            />
            <Select
              value={row.type}
              onChange={(v) => patchRow(setter, row.key, { type: v })}
              options={FIELD_TYPES.map((t) => ({ value: t, label: t }))}
              style={{ width: 110 }}
            />
            <Button
              type="text"
              danger
              icon={<DeleteOutlined />}
              onClick={() => setter((prev) => prev.filter((r) => r.key !== row.key))}
            />
          </Flex>
          <Flex gap={8} align="center" style={{ marginBottom: 8 }}>
            <span style={{ fontSize: 12 }}>可选</span>
            <Switch
              size="small"
              checked={row.optional}
              onChange={(v) => patchRow(setter, row.key, { optional: v })}
            />
            <Input
              placeholder="说明（可选）"
              value={row.description}
              onChange={(e) => patchRow(setter, row.key, { description: e.target.value })}
              style={{ flex: 1 }}
            />
          </Flex>
          {row.type === 'array' ? (
            <Flex gap={8} align="center">
              <span style={{ fontSize: 12 }}>元素类型</span>
              <Select
                value={row.itemsType}
                onChange={(v) => patchRow(setter, row.key, { itemsType: v })}
                options={FIELD_TYPES.map((t) => ({ value: t, label: t }))}
                style={{ width: 130 }}
              />
            </Flex>
          ) : null}
          {row.type === 'object' ? (
            <Input.TextArea
              rows={2}
              spellCheck={false}
              placeholder='properties（JSON，可选，如 {"body": {"type": "string"}}）'
              value={row.propertiesText}
              onChange={(e) => patchRow(setter, row.key, { propertiesText: e.target.value })}
            />
          ) : null}
        </div>
      ))}
    </Space>
  );

  return (
    <Modal
      title={initial ? `编辑脚本 · ${initial.id}` : '编辑脚本'}
      open={open}
      onCancel={onCancel}
      onOk={() => void handleOk()}
      confirmLoading={saving}
      okText="保存"
      cancelText="取消"
      width={640}
      destroyOnHidden
    >
      <Form layout="vertical">
        <Flex gap={8}>
          <Form.Item label="脚本名称" required style={{ flex: 1 }}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如 数据同步" />
          </Form.Item>
          <Form.Item label="版本" required style={{ width: 140 }}>
            <Input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="如 1.0.0" />
          </Form.Item>
        </Flex>
        <Form.Item label="ID（不可修改）">
          <Input value={initial?.id ?? ''} disabled />
        </Form.Item>
        <Form.Item label="描述">
          <Input.TextArea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="脚本用途说明（可选）"
          />
        </Form.Item>
        <Form.Item
          label={
            <RowListHeader
              title="输入"
              onAdd={() =>
                setInputRows((prev) => [
                  ...prev,
                  {
                    key: newRowKey('in'),
                    name: '',
                    type: 'string',
                    optional: false,
                    description: '',
                    itemsType: 'string',
                    propertiesText: '',
                  },
                ])
              }
            />
          }
        >
          {renderFieldRows(inputRows, setInputRows)}
        </Form.Item>
        <Form.Item
          label={
            <RowListHeader
              title="输出"
              onAdd={() =>
                setOutputRows((prev) => [
                  ...prev,
                  {
                    key: newRowKey('out'),
                    name: '',
                    type: 'string',
                    optional: false,
                    description: '',
                    itemsType: 'string',
                    propertiesText: '',
                  },
                ])
              }
            />
          }
        >
          {renderFieldRows(outputRows, setOutputRows)}
        </Form.Item>
        <Form.Item
          label={
            <RowListHeader
              title="环境槽位"
              onAdd={() =>
                setSlotRows((prev) => [
                  ...prev,
                  { key: newRowKey('slot'), slotKey: '', name: '', description: '' },
                ])
              }
            />
          }
        >
          <Space direction="vertical" style={{ width: '100%' }} size="small">
            {slotRows.map((row) => (
              <Flex key={row.key} gap={8}>
                <Input
                  placeholder="key（camelCase）"
                  value={row.slotKey}
                  onChange={(e) =>
                    setSlotRows((prev) =>
                      prev.map((r) => (r.key === row.key ? { ...r, slotKey: e.target.value } : r)),
                    )
                  }
                  style={{ flex: 1 }}
                />
                <Input
                  placeholder="名称"
                  value={row.name}
                  onChange={(e) =>
                    setSlotRows((prev) =>
                      prev.map((r) => (r.key === row.key ? { ...r, name: e.target.value } : r)),
                    )
                  }
                  style={{ flex: 1 }}
                />
                <Button
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => setSlotRows((prev) => prev.filter((r) => r.key !== row.key))}
                />
              </Flex>
            ))}
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            槽位供工作流中的环境绑定使用；应用墙独立运行时统一注入所选环境。
          </Typography.Text>
        </Form.Item>
        {formError ? <Typography.Text type="danger">{formError}</Typography.Text> : null}
      </Form>
    </Modal>
  );
}

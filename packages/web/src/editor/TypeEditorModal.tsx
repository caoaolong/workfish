import { useEffect, useState } from 'react';
import {
  Button,
  Flex,
  Form,
  Input,
  Modal,
  Select,
  Switch,
  Table,
  Typography,
} from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import type { FieldSpec, TypeDef } from '@workfish/spec';

const FIELD_TYPES: FieldSpec['type'][] = [
  'string',
  'number',
  'boolean',
  'null',
  'any',
  'array',
  'object',
  'ref',
];

type FieldRow = {
  key: string;
  name: string;
  type: FieldSpec['type'];
  optional: boolean;
  description: string;
  ref: string;
  itemsType: FieldSpec['type'];
};

type Props = {
  open: boolean;
  initial?: TypeDef | null;
  existingIds: string[];
  typeOptions: TypeDef[];
  onCancel: () => void;
  onSave: (def: TypeDef) => Promise<void>;
};

function toRows(fields: Record<string, FieldSpec>): FieldRow[] {
  return Object.entries(fields).map(([name, field], i) => ({
    key: `${name}-${i}`,
    name,
    type: field.type,
    optional: Boolean(field.optional),
    description: field.description ?? '',
    ref: field.ref ?? '',
    itemsType: field.items?.type ?? 'string',
  }));
}

function rowsToFields(rows: FieldRow[]): Record<string, FieldSpec> {
  const fields: Record<string, FieldSpec> = {};
  for (const row of rows) {
    const name = row.name.trim();
    if (!name) {
      continue;
    }
    const field: FieldSpec = {
      type: row.type,
      ...(row.optional ? { optional: true } : {}),
      ...(row.description.trim() ? { description: row.description.trim() } : {}),
    };
    if (row.type === 'ref' && row.ref.trim()) {
      field.ref = row.ref.trim();
    }
    if (row.type === 'array') {
      field.items = { type: row.itemsType };
    }
    if (row.type === 'object') {
      field.properties = {};
    }
    fields[name] = field;
  }
  return fields;
}

export function TypeEditorModal({
  open,
  initial,
  existingIds,
  typeOptions,
  onCancel,
  onSave,
}: Props) {
  const isEdit = Boolean(initial);
  const [saving, setSaving] = useState(false);
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [rows, setRows] = useState<FieldRow[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setFormError(null);
    if (initial) {
      setId(initial.id);
      setName(initial.name);
      setRows(toRows(initial.fields));
    } else {
      setId('');
      setName('');
      setRows([]);
    }
  }, [open, initial]);

  const updateRow = (key: string, patch: Partial<FieldRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const handleOk = async () => {
    setFormError(null);
    const trimmedId = id.trim();
    const trimmedName = name.trim();
    if (!trimmedId || !trimmedName) {
      setFormError('请填写类型 ID 与名称');
      return;
    }
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(trimmedId)) {
      setFormError('类型 ID 需字母开头，仅含字母、数字、_、-');
      return;
    }
    if (!isEdit && existingIds.includes(trimmedId)) {
      setFormError('类型 ID 已存在');
      return;
    }
    const fields = rowsToFields(rows);
    if (Object.keys(fields).length === 0) {
      setFormError('请至少添加一个字段');
      return;
    }
    for (const [fname, field] of Object.entries(fields)) {
      if (field.type === 'ref' && !field.ref) {
        setFormError(`字段「${fname}」为 ref 时必须指定引用类型`);
        return;
      }
    }
    setSaving(true);
    try {
      await onSave({ id: trimmedId, name: trimmedName, fields });
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={isEdit ? '编辑数据结构' : '新建数据结构'}
      open={open}
      onCancel={onCancel}
      onOk={() => void handleOk()}
      confirmLoading={saving}
      width={720}
      destroyOnClose
      okText="保存"
      cancelText="取消"
    >
      <Form layout="vertical" style={{ marginBottom: 12 }}>
        <Form.Item label="类型 ID" required>
          <Input
            value={id}
            disabled={isEdit}
            onChange={(e) => setId(e.target.value)}
            placeholder="例如 JdbcConnection"
            autoComplete="off"
          />
        </Form.Item>
        <Form.Item label="显示名称" required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如 JDBC 连接"
            autoComplete="off"
          />
        </Form.Item>
      </Form>

      <Flex align="center" justify="space-between">
        <Typography.Text strong>字段</Typography.Text>
        <Button
          size="small"
          type="dashed"
          icon={<PlusOutlined />}
          onClick={() =>
            setRows((prev) => [
              ...prev,
              {
                key: `new-${Date.now()}`,
                name: '',
                type: 'string',
                optional: false,
                description: '',
                ref: '',
                itemsType: 'string',
              },
            ])
          }
        >
          添加字段
        </Button>
      </Flex>

      <Table
        size="small"
        pagination={false}
        style={{ marginTop: 8 }}
        dataSource={rows}
        locale={{ emptyText: '暂无字段' }}
        columns={[
          {
            title: '名称',
            dataIndex: 'name',
            width: 120,
            render: (_, row) => (
              <Input
                size="small"
                value={row.name}
                placeholder="fieldName"
                onChange={(e) => updateRow(row.key, { name: e.target.value })}
              />
            ),
          },
          {
            title: '类型',
            dataIndex: 'type',
            width: 110,
            render: (_, row) => (
              <Select
                size="small"
                style={{ width: '100%' }}
                value={row.type}
                options={FIELD_TYPES.map((t) => ({ value: t, label: t }))}
                onChange={(v) => updateRow(row.key, { type: v })}
              />
            ),
          },
          {
            title: '细节',
            key: 'detail',
            render: (_, row) => {
              if (row.type === 'ref') {
                return (
                  <Select
                    size="small"
                    style={{ width: '100%' }}
                    value={row.ref || undefined}
                    placeholder="引用类型"
                    options={typeOptions
                      .filter((t) => t.id !== trimmedIdSafe(id, initial?.id))
                      .map((t) => ({ value: t.id, label: `${t.name} (${t.id})` }))}
                    onChange={(v) => updateRow(row.key, { ref: v })}
                    allowClear
                  />
                );
              }
              if (row.type === 'array') {
                return (
                  <Select
                    size="small"
                    style={{ width: '100%' }}
                    value={row.itemsType}
                    options={FIELD_TYPES.filter((t) => t !== 'array').map((t) => ({
                      value: t,
                      label: `items: ${t}`,
                    }))}
                    onChange={(v) => updateRow(row.key, { itemsType: v })}
                  />
                );
              }
              return (
                <Input
                  size="small"
                  value={row.description}
                  placeholder="说明（可选）"
                  onChange={(e) => updateRow(row.key, { description: e.target.value })}
                />
              );
            },
          },
          {
            title: '可选',
            dataIndex: 'optional',
            width: 64,
            align: 'center',
            render: (_, row) => (
              <Switch
                size="small"
                checked={row.optional}
                onChange={(v) => updateRow(row.key, { optional: v })}
              />
            ),
          },
          {
            title: '',
            width: 48,
            render: (_, row) => (
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
              />
            ),
          },
        ]}
      />

      {formError ? (
        <Typography.Text type="danger" style={{ display: 'block', marginTop: 12 }}>
          {formError}
        </Typography.Text>
      ) : null}
    </Modal>
  );
}

function trimmedIdSafe(current: string, fallback?: string) {
  return current.trim() || fallback || '';
}

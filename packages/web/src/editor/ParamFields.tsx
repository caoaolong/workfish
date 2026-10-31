import { useState } from 'react';
import { Input, InputNumber, Space, Switch, Tag, Typography } from 'antd';
import type { NodeSpec } from '@workfish/spec';

export function readInputValues(params: Record<string, unknown> | undefined): Record<string, unknown> {
  const raw = params?.inputs;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  return { ...(raw as Record<string, unknown>) };
}

function stringifyJson(value: unknown): string {
  if (value === undefined) {
    return '';
  }
  try {
    return JSON.stringify(value, null, 2) ?? '';
  } catch {
    return '';
  }
}

/** 按 NodeSpec.inputs 声明渲染的参数字段（string/number/boolean/null/any/array/object） */
export function ParamFields({
  spec,
  values,
  onChange,
}: {
  spec: NodeSpec;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown> | undefined) => void;
}) {
  const entries = Object.entries(spec.inputs);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  if (entries.length === 0) {
    return <Typography.Text type="secondary">该脚本无输入参数</Typography.Text>;
  }

  const setValue = (name: string, value: unknown) => {
    const next = { ...values };
    if (value === undefined) {
      delete next[name];
    } else {
      next[name] = value;
    }
    onChange(Object.keys(next).length > 0 ? next : undefined);
  };

  const commitJson = (name: string, text: string) => {
    if (!text.trim()) {
      setDrafts((d) => {
        const next = { ...d };
        delete next[name];
        return next;
      });
      setErrors((e) => {
        const next = { ...e };
        delete next[name];
        return next;
      });
      setValue(name, undefined);
      return;
    }
    try {
      setValue(name, JSON.parse(text) as unknown);
      setDrafts((d) => {
        const next = { ...d };
        delete next[name];
        return next;
      });
      setErrors((e) => {
        const next = { ...e };
        delete next[name];
        return next;
      });
    } catch {
      setDrafts((d) => ({ ...d, [name]: text }));
      setErrors((e) => ({ ...e, [name]: 'JSON 解析失败' }));
    }
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="small">
      {entries.map(([name, field]) => (
        <div key={name}>
          <div style={{ marginBottom: 4 }}>
            <Typography.Text strong>{name}</Typography.Text>{' '}
            <Typography.Text code type="secondary">
              {field.type}
            </Typography.Text>{' '}
            {field.optional ? (
              <Tag style={{ marginLeft: 4 }}>可选</Tag>
            ) : (
              <Tag color="blue" style={{ marginLeft: 4 }}>
                必填
              </Tag>
            )}
          </div>
          {field.description ? (
            <Typography.Paragraph type="secondary" style={{ margin: '0 0 4px', fontSize: 12 }}>
              {field.description}
            </Typography.Paragraph>
          ) : null}
          {field.type === 'string' ? (
            <Input
              allowClear
              placeholder={field.optional ? '可选' : '请输入'}
              value={typeof values[name] === 'string' ? (values[name] as string) : ''}
              onChange={(e) => setValue(name, e.target.value === '' ? undefined : e.target.value)}
            />
          ) : null}
          {field.type === 'number' ? (
            <InputNumber
              style={{ width: '100%' }}
              placeholder={field.optional ? '可选' : '请输入数字'}
              value={typeof values[name] === 'number' ? (values[name] as number) : null}
              onChange={(v) =>
                setValue(name, typeof v === 'number' && !Number.isNaN(v) ? v : undefined)
              }
            />
          ) : null}
          {field.type === 'boolean' ? (
            <Switch checked={values[name] === true} onChange={(v) => setValue(name, v)} />
          ) : null}
          {field.type === 'null' ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              固定为 null，无需填写
            </Typography.Text>
          ) : null}
          {field.type === 'any' || field.type === 'array' || field.type === 'object' ? (
            <>
              <Input.TextArea
                rows={3}
                spellCheck={false}
                placeholder={field.optional ? '可选，JSON 格式' : 'JSON 格式'}
                value={drafts[name] ?? stringifyJson(values[name])}
                status={errors[name] ? 'error' : undefined}
                onChange={(e) => {
                  const text = e.target.value;
                  if (!text.trim()) {
                    commitJson(name, text);
                    return;
                  }
                  try {
                    setValue(name, JSON.parse(text) as unknown);
                    setDrafts((d) => {
                      const next = { ...d };
                      delete next[name];
                      return next;
                    });
                    setErrors((e2) => {
                      const next = { ...e2 };
                      delete next[name];
                      return next;
                    });
                  } catch {
                    setDrafts((d) => ({ ...d, [name]: text }));
                    setErrors((e2) => ({ ...e2, [name]: 'JSON 解析失败' }));
                  }
                }}
                onBlur={(e) => commitJson(name, e.target.value)}
              />
              {errors[name] ? (
                <Typography.Text type="danger" style={{ fontSize: 12 }}>
                  {errors[name]}
                </Typography.Text>
              ) : null}
            </>
          ) : null}
        </div>
      ))}
    </Space>
  );
}

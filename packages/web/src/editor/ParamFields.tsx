import { useState, type ReactNode } from 'react';
import { Form, Input, InputNumber, Switch, Tooltip, Typography } from 'antd';
import type { FieldSpec, NodeSpec } from '@workfish/spec';

export function readInputValues(params: Record<string, unknown> | undefined): Record<string, unknown> {
  const raw = params?.inputs;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  return { ...(raw as Record<string, unknown>) };
}

/** 环境引用占位符形如 <NAME:VALUE> */
export function formatEnvRef(name: string, value: string): string {
  return `<${name}:${value}>`;
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

function stringifyManual(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return stringifyJson(value);
}

function valuesEqualEnv(manual: unknown, envRaw: string, field: FieldSpec): boolean {
  if (String(manual) === envRaw) {
    return true;
  }
  if (field.type === 'number') {
    const n = Number(envRaw);
    return typeof manual === 'number' && Number.isFinite(n) && manual === n;
  }
  if (field.type === 'boolean') {
    const lower = envRaw.trim().toLowerCase();
    const asBool = lower === 'true' || lower === '1' || lower === 'yes';
    const asFalse = lower === 'false' || lower === '0' || lower === 'no';
    if (asBool) {
      return manual === true;
    }
    if (asFalse) {
      return manual === false;
    }
  }
  return false;
}

/** 字段是否走环境绑定（无手动覆盖，或值仍等于环境值） */
export function isInputBoundToEnv(
  name: string,
  field: FieldSpec,
  values: Record<string, unknown>,
  envValues: Record<string, string> | undefined,
): boolean {
  if (!envValues || !Object.prototype.hasOwnProperty.call(envValues, name)) {
    return false;
  }
  if (!Object.prototype.hasOwnProperty.call(values, name)) {
    return true;
  }
  return valuesEqualEnv(values[name], envValues[name]!, field);
}

/** 按 NodeSpec.inputs 声明渲染的参数字段（string/number/boolean/null/any/array/object） */
export function ParamFields({
  spec,
  values,
  onChange,
  envValues,
}: {
  spec: NodeSpec;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown> | undefined) => void;
  /** 当前所选环境的键值；同名且未手动覆盖时用 <NAME:VALUE> 作占位符 */
  envValues?: Record<string, string>;
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
    <Form
      className="param-fields-form"
      layout="horizontal"
      size="small"
      labelAlign="left"
      colon={false}
      labelCol={{ flex: '0 0 128px' }}
      wrapperCol={{ flex: '1 1 0', style: { minWidth: 0 } }}
      requiredMark
    >
      {entries.map(([name, field]) => {
        const envRaw = envValues?.[name];
        const bound = isInputBoundToEnv(name, field, values, envValues);
        const envPlaceholder =
          envRaw !== undefined ? formatEnvRef(name, envRaw) : undefined;

        const label = (
          <Tooltip
            title={
              field.description ? (
                <span>
                  {name}
                  <br />
                  {field.description}
                </span>
              ) : (
                name
              )
            }
          >
            <span className="param-fields-label-text">{name}</span>
          </Tooltip>
        );

        let control: ReactNode = null;

        if (field.type === 'string' || (bound && (field.type === 'boolean' || field.type === 'number'))) {
          // 环境绑定时值为空，占位符显示 <NAME:VALUE>；手动输入后显示实际值
          const placeholder =
            envPlaceholder ?? (field.optional ? '可选' : field.type === 'number' ? '请输入数字' : '请输入');
          control = (
            <Input
              className={bound ? 'param-fields-env-ref' : undefined}
              allowClear
              placeholder={placeholder}
              value={bound ? '' : stringifyManual(values[name])}
              onChange={(e) => {
                const text = e.target.value;
                if (text === '') {
                  setValue(name, undefined);
                  return;
                }
                if (field.type === 'number') {
                  const n = Number(text);
                  setValue(name, Number.isFinite(n) ? n : text);
                  return;
                }
                if (field.type === 'boolean') {
                  const lower = text.trim().toLowerCase();
                  if (lower === 'true' || lower === '1') {
                    setValue(name, true);
                    return;
                  }
                  if (lower === 'false' || lower === '0') {
                    setValue(name, false);
                    return;
                  }
                }
                setValue(name, text);
              }}
            />
          );
        } else if (field.type === 'number') {
          control = (
            <InputNumber
              style={{ width: '100%' }}
              placeholder={envPlaceholder ?? (field.optional ? '可选' : '请输入数字')}
              value={typeof values[name] === 'number' ? (values[name] as number) : null}
              onChange={(v) =>
                setValue(name, typeof v === 'number' && !Number.isNaN(v) ? v : undefined)
              }
            />
          );
        } else if (field.type === 'boolean') {
          control = <Switch checked={values[name] === true} onChange={(v) => setValue(name, v)} />;
        } else if (field.type === 'null') {
          control = (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              固定为 null
            </Typography.Text>
          );
        } else if (field.type === 'any' || field.type === 'array' || field.type === 'object') {
          control = (
            <Input.TextArea
              rows={3}
              spellCheck={false}
              className={bound ? 'param-fields-env-ref' : undefined}
              placeholder={
                envPlaceholder ?? (field.optional ? '可选，JSON 格式' : 'JSON 格式')
              }
              value={bound ? '' : (drafts[name] ?? stringifyManual(values[name]))}
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
          );
        }

        return (
          <Form.Item
            key={name}
            label={label}
            required={!field.optional}
            className={field.optional ? 'param-fields-item-optional' : 'param-fields-item-required'}
            extra={
              errors[name] ? (
                <Typography.Text type="danger" style={{ fontSize: 12 }}>
                  {errors[name]}
                </Typography.Text>
              ) : undefined
            }
            style={{ marginBottom: 10 }}
          >
            {control}
          </Form.Item>
        );
      })}
    </Form>
  );
}

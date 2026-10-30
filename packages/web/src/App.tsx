import { useEffect, useState } from 'react';
import { Button, Result, Spin, Typography } from 'antd';
import { formatApiError, getBootstrap } from './api/client.js';
import { EditorPage } from './editor/EditorPage.js';
import { InitWizard } from './pages/InitWizard.js';
import { ThemeToggle } from './theme.js';
import type { BootstrapResponse, InitResponse, WorkfishConfig } from './types.js';

type AppPhase = 'loading' | 'bootstrap-error' | 'wizard' | 'editor';

export function App() {
  const [phase, setPhase] = useState<AppPhase>('loading');
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [config, setConfig] = useState<WorkfishConfig | null>(null);
  const [initWarning, setInitWarning] = useState<string | undefined>();
  const [defaultWorkspacePath, setDefaultWorkspacePath] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data: BootstrapResponse = await getBootstrap();
        if (cancelled) {
          return;
        }
        setDefaultWorkspacePath(data.defaultWorkspacePath);
        if (data.initialized && data.config) {
          setConfig(data.config);
          setPhase('editor');
        } else {
          setPhase('wizard');
        }
      } catch (e) {
        if (!cancelled) {
          setBootstrapError(formatApiError(e));
          setPhase('bootstrap-error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleInitComplete = (result: InitResponse) => {
    setConfig(result.config);
    setInitWarning(result.warning);
    setPhase('editor');
  };

  return (
    <div className={`app-shell${phase === 'editor' ? ' app-shell-editor' : ''}`}>
      {phase !== 'editor' ? <ThemeToggle className="theme-toggle-fixed" /> : null}

      {phase === 'loading' ? (
        <div className="center">
          <Spin size="large" tip="正在连接本地服务…" />
        </div>
      ) : null}

      {phase === 'bootstrap-error' ? (
        <Result
          status="error"
          title="无法加载应用状态"
          subTitle={
            <>
              <Typography.Paragraph type="danger">{bootstrapError}</Typography.Paragraph>
              <Typography.Paragraph type="secondary">
                请确认 API 服务已启动（默认端口 8787），并通过 Vite 代理访问。
              </Typography.Paragraph>
            </>
          }
          extra={
            <Button type="primary" onClick={() => window.location.reload()}>
              重试
            </Button>
          }
        />
      ) : null}

      {phase === 'wizard' ? (
        <InitWizard
          onComplete={handleInitComplete}
          defaultWorkspacePath={defaultWorkspacePath}
        />
      ) : null}

      {phase === 'editor' && config ? (
        <EditorPage config={config} initWarning={initWarning} />
      ) : null}
    </div>
  );
}

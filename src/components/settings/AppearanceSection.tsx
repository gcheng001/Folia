import { useState } from 'react';
import { getSettings, updateSettings, type AppSettings } from '../../services/settingsService';

const ZOOM_LEVELS = [80, 90, 100, 110, 120];

export function AppearanceSection() {
  const [settings, setSettings] = useState(() => getSettings());

  const handleChange = (patch: Partial<AppSettings>) => {
    updateSettings(patch);
    setSettings(getSettings());
  };

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">外观</h3>

      <div className="settings-row">
        <div>
          <div className="settings-label">主题</div>
        </div>
        <select
          className="settings-select"
          value={settings.theme}
          onChange={(e) => handleChange({ theme: e.target.value as AppSettings['theme'] })}
        >
          <option value="light">亮色</option>
          <option value="dark">暗色</option>
        </select>
      </div>

      <div className="settings-row">
        <div>
          <div className="settings-label">状态栏路径</div>
          <div className="settings-desc">选择底部文件路径的显示方式。</div>
        </div>
        <select
          className="settings-select"
          aria-label="状态栏路径"
          value={settings.statusBarPathStyle}
          onChange={(e) => handleChange({ statusBarPathStyle: e.target.value as AppSettings['statusBarPathStyle'] })}
        >
          <option value="basename">仅文件名</option>
          <option value="middle">中间省略</option>
          <option value="full">完整路径</option>
        </select>
      </div>

      <div className="settings-row">
        <div>
          <div className="settings-label">界面缩放</div>
        </div>
        <select
          className="settings-select"
          value={settings.zoomLevel}
          onChange={(e) => handleChange({ zoomLevel: Number(e.target.value) })}
        >
          {ZOOM_LEVELS.map((z) => (
            <option key={z} value={z}>{z}%</option>
          ))}
        </select>
      </div>
    </div>
  );
}

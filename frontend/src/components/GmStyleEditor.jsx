/**
 * GmStyleEditor — GM 叙事「倾向性」6 滑块编辑器(线性 0-100)。
 * scope='user'  → 写用户级默认(window.api.me.setGmStyle)
 * scope='script'→ 写剧本级(window.api.scripts.setGmStyle(scriptId)),仅 owner 可写。
 *
 * 后端:agents/gm/style_harness 的 6 旋钮。滑块值 0-100 确定性映射到 GM 提示词片段。
 * 读现值用后端 normalize_profile 兜底(缺的旋钮取默认),不依赖前端硬编码默认。
 */
import React from 'react';
import CSBox from '@cloudscape-design/components/box';
import CSButton from '@cloudscape-design/components/button';
import CSHeader from '@cloudscape-design/components/header';
import CSSpaceBetween from '@cloudscape-design/components/space-between';
import CSAlert from '@cloudscape-design/components/alert';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';

// 6 旋钮的中文标签 + 说明 + 两端语义(low ↔ high)。顺序即展示顺序。
const KNOBS = [
  { key: 'reply_length',
    get label() { return i18n.t('components.gm_style_editor.knobs.reply_length.label'); },
    get lo()    { return i18n.t('components.gm_style_editor.knobs.reply_length.lo'); },
    get hi()    { return i18n.t('components.gm_style_editor.knobs.reply_length.hi'); },
    get desc()  { return i18n.t('components.gm_style_editor.knobs.reply_length.desc'); } },
  { key: 'player_action_focus',
    get label() { return i18n.t('components.gm_style_editor.knobs.player_action_focus.label'); },
    get lo()    { return i18n.t('components.gm_style_editor.knobs.player_action_focus.lo'); },
    get hi()    { return i18n.t('components.gm_style_editor.knobs.player_action_focus.hi'); },
    get desc()  { return i18n.t('components.gm_style_editor.knobs.player_action_focus.desc'); } },
  { key: 'drama_density',
    get label() { return i18n.t('components.gm_style_editor.knobs.drama_density.label'); },
    get lo()    { return i18n.t('components.gm_style_editor.knobs.drama_density.lo'); },
    get hi()    { return i18n.t('components.gm_style_editor.knobs.drama_density.hi'); },
    get desc()  { return i18n.t('components.gm_style_editor.knobs.drama_density.desc'); } },
  { key: 'interiority',
    get label() { return i18n.t('components.gm_style_editor.knobs.interiority.label'); },
    get lo()    { return i18n.t('components.gm_style_editor.knobs.interiority.lo'); },
    get hi()    { return i18n.t('components.gm_style_editor.knobs.interiority.hi'); },
    get desc()  { return i18n.t('components.gm_style_editor.knobs.interiority.desc'); } },
  { key: 'cliffhanger',
    get label() { return i18n.t('components.gm_style_editor.knobs.cliffhanger.label'); },
    get lo()    { return i18n.t('components.gm_style_editor.knobs.cliffhanger.lo'); },
    get hi()    { return i18n.t('components.gm_style_editor.knobs.cliffhanger.hi'); },
    get desc()  { return i18n.t('components.gm_style_editor.knobs.cliffhanger.desc'); } },
  { key: 'guidance_force',
    get label() { return i18n.t('components.gm_style_editor.knobs.guidance_force.label'); },
    get lo()    { return i18n.t('components.gm_style_editor.knobs.guidance_force.lo'); },
    get hi()    { return i18n.t('components.gm_style_editor.knobs.guidance_force.hi'); },
    get desc()  { return i18n.t('components.gm_style_editor.knobs.guidance_force.desc'); } },
];

export default function GmStyleEditor({ scope = 'user', scriptId = null, canWrite = true }) {
  const { t } = useTranslation();
  const [vals, setVals] = React.useState(null);     // {key: 0-100}
  const [base, setBase] = React.useState(null);     // 加载时快照,用于「是否有改动」
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState('');
  const [okMsg, setOkMsg] = React.useState('');

  const load = React.useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const r = scope === 'script'
        ? await window.api.scripts.getGmStyle(scriptId)
        : await window.api.me.getGmStyle();
      const gs = (r && r.gm_style) || {};
      setVals(gs); setBase(gs);
    } catch (e) {
      setErr(e?.message || t('components.gm_style_editor.err_load'));
    } finally { setLoading(false); }
  }, [scope, scriptId]);

  React.useEffect(() => { load(); }, [load]);

  const dirty = vals && base && KNOBS.some((k) => vals[k.key] !== base[k.key]);

  const setOne = (key, v) => {
    setOkMsg('');
    setVals((p) => ({ ...p, [key]: Math.max(0, Math.min(100, parseInt(v, 10) || 0)) }));
  };

  const save = async () => {
    setSaving(true); setErr(''); setOkMsg('');
    try {
      // 只提交「相对加载时基线有改动」的旋钮 — 剧本级面板现在显示的是【有效值】(已叠加
      // 你的个人默认),若整盘 6 个旋钮都写进剧本 override,会把继承来的个人默认也"焊死"成
      // 本剧本专属,之后改个人默认对本剧本就不生效了。只写改动的旋钮 → 未动的继续继承。
      const patch = {};
      KNOBS.forEach((k) => { if (!base || vals[k.key] !== base[k.key]) patch[k.key] = vals[k.key]; });
      const r = scope === 'script'
        ? await window.api.scripts.setGmStyle(scriptId, patch)
        : await window.api.me.setGmStyle(patch);
      const saved = (r && r.gm_style) || patch;
      // 后端可能返回部分键,合并回完整 vals
      setVals((p) => ({ ...p, ...saved })); setBase((p) => ({ ...p, ...saved }));
      setOkMsg(scope === 'script'
        ? t('components.gm_style_editor.ok_saved_script')
        : t('components.gm_style_editor.ok_saved_user'));
    } catch (e) {
      setErr(e?.message || t('components.gm_style_editor.err_save'));
    } finally { setSaving(false); }
  };

  const reset = () => { setVals(base); setOkMsg(''); };

  if (loading) return <CSBox color="text-body-secondary" padding="m">{t('components.gm_style_editor.loading')}</CSBox>;

  return (
    <CSSpaceBetween size="m">
      <CSHeader
        variant="h3"
        description={scope === 'script'
          ? t('components.gm_style_editor.desc_script')
          : t('components.gm_style_editor.desc_user')}
        actions={canWrite ? (
          <CSSpaceBetween direction="horizontal" size="xs">
            {dirty && <CSButton onClick={reset} disabled={saving}>{t('components.gm_style_editor.revert')}</CSButton>}
            <CSButton variant="primary" onClick={save} loading={saving} disabled={!dirty}>{t('common.save')}</CSButton>
          </CSSpaceBetween>
        ) : undefined}
      >{t('components.gm_style_editor.title')}</CSHeader>

      {err && <CSAlert type="error" header={t('components.gm_style_editor.err_header')}>{err}</CSAlert>}
      {okMsg && <CSAlert type="success" dismissible onDismiss={() => setOkMsg('')}>{okMsg}</CSAlert>}
      {!canWrite && <CSAlert type="info">{t('components.gm_style_editor.readonly_notice')}</CSAlert>}

      <div style={{ display: 'grid', gap: 18 }}>
        {KNOBS.map((k) => (
          <div key={k.key}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
              <strong style={{ fontSize: 14 }}>{k.label}</strong>
              <span style={{ fontSize: 12, color: 'var(--text-quiet, #9a948c)', fontVariantNumeric: 'tabular-nums' }}>{vals?.[k.key] ?? 0}</span>
            </div>
            <input
              type="range" min={0} max={100} step={5}
              value={vals?.[k.key] ?? 0}
              disabled={!canWrite || saving}
              onChange={(e) => setOne(k.key, e.target.value)}
              style={{ width: '100%', accentColor: 'var(--accent, #c96442)', cursor: canWrite ? 'pointer' : 'not-allowed' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted, #b8b2a8)' }}>
              <span>{k.lo}</span><span>{k.hi}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-quiet, #9a948c)', marginTop: 3, lineHeight: 1.5 }}>{k.desc}</div>
          </div>
        ))}
      </div>
    </CSSpaceBetween>
  );
}

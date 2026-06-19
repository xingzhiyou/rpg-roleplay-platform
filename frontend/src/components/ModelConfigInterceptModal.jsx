import React from 'react';
import { useTranslation } from 'react-i18next';
import CSModal from '@cloudscape-design/components/modal';
import CSBox from '@cloudscape-design/components/box';
import CSSpaceBetween from '@cloudscape-design/components/space-between';
import CSButton from '@cloudscape-design/components/button';
import CSAlert from '@cloudscape-design/components/alert';
import CSFormField from '@cloudscape-design/components/form-field';
import CSSelect from '@cloudscape-design/components/select';
import CSSegmentedControl from '@cloudscape-design/components/segmented-control';
import AgentModelPicker from './AgentModelPicker.jsx';
import { EditApiModal, ProviderCard, PROVIDERS_CONFIG, normalizeApiId } from '../pages/settings.jsx';
import { moduleByPrefix } from '../agent-modules.js';

/* config_card 能力 → 前端配置映射(后端契约里的 capability 字段)。
   一处定义,ConfirmStrip 的内联卡片与本拦截弹窗共用,避免两份各写一套。
   prefPrefix / capabilityFilter 从单一来源 agent-modules.js 派生(语义统一 #19),
   避免与「模块模型」清单的落库 key / 能力过滤漂移;label / defaultProvider 为本弹窗专属。
     prefPrefix       : user_preferences 命名空间(后端各 agent resolve 读同名 key)
     capabilityFilter : AgentModelPicker 只展示含此 capability 的模型(null=不过滤,LLM)
     label            : 给用户看的能力名(中文)
     defaultProvider  : 该能力下「补 Key」时默认选中的 provider(用户可改) */
// 子集投影:image→image_gen 模块 · embedding→embed 模块 · llm→gm 模块。
const _capModule = (prefix) => moduleByPrefix[prefix] || {};
export const CAP_CONFIG = {
  image:     { prefPrefix: 'image_gen', capabilityFilter: _capModule('image_gen').capabilityFilter || null, defaultProvider: 'dashscope' },
  embedding: { prefPrefix: 'embed',     capabilityFilter: _capModule('embed').capabilityFilter || null,     defaultProvider: 'openai' },
  llm:       { prefPrefix: 'gm',        capabilityFilter: _capModule('gm').capabilityFilter || null,         defaultProvider: 'deepseek' },
};

export function capConfig(capability) {
  return CAP_CONFIG[capability] || CAP_CONFIG.llm;
}

/* InlineProviderConfig —— 就地填 API Key 的内联面板。
   复用设置页的 ProviderCard(单 provider 的 api_key + base_url 输入,保存走
   window.api.credentials.set → 自动广播 rpg-credentials-updated)。
   provider 用一个小 <select> 让用户切换;ProviderCard 只是受控展示,凭据读写都在这里。

   props:
     capability    : config_card 的能力(决定默认 provider)
     defaultApiId  : 优先选中的 provider(通常来自 item.api_id)
     onSaved?      : (providerId) => void  保存成功后回调(父组件据此点亮「继续」) */
export function InlineProviderConfig({ capability = 'llm', defaultApiId = '', onSaved = null }) {
  const { useState, useEffect, useMemo } = React;
  const { t } = useTranslation();
  const cap = capConfig(capability);
  // 可选 provider:沿用设置页同一份 PROVIDERS_CONFIG。
  // 排除 agent_platform(走 SA JSON 上传,不是单 key 输入,内联不便)与编辑弹窗隐藏项;
  // 用户需要 Vertex SA 时仍可走「去模型设置」。
  const providers = useMemo(
    () => PROVIDERS_CONFIG.filter((p) => !p.hidden_in_edit_modal && p.special !== 'agent_platform'),
    [],
  );
  const initialId = (() => {
    const want = normalizeApiId(defaultApiId || '');
    if (want && providers.some((p) => p.id === want)) return want;
    if (providers.some((p) => p.id === cap.defaultProvider)) return cap.defaultProvider;
    return providers[0] ? providers[0].id : '';
  })();
  const [providerId, setProviderId] = useState(initialId);
  const [creds, setCreds] = useState({});
  const [saving, setSaving] = useState(false);
  const [alibabaMode, setAlibabaMode] = useState('openai_compat');  // DashScope mode toggle

  // 读一次当前凭据(用于 ProviderCard 显示「已配置」/已存 base_url),并随广播刷新。
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await window.api.credentials.list().catch(() => ({ items: [] }));
        if (cancelled) return;
        const map = {};
        for (const c of (r?.items || r?.credentials || [])) {
          const pid = normalizeApiId(c.api_id || c.id);
          map[pid] = {
            has_key: !!c.has_credential || !!c.has_key,
            key_hint: c.key_hint || '',
            base_url: c.base_url_override || '',
          };
        }
        setCreds(map);
      } catch (_) {}
    };
    load();
    window.addEventListener('rpg-credentials-updated', load);
    return () => { cancelled = true; window.removeEventListener('rpg-credentials-updated', load); };
  }, []);

  // ProviderCard 的 onSaveKey:保存 key(+ base_url)。credentials.set 内部已广播
  // rpg-credentials-updated,父组件据此点亮「继续」。
  const onSaveKey = async (pid, apiKey, baseUrl) => {
    setSaving(true);
    try {
      if (apiKey && apiKey.trim()) {
        await window.api.credentials.set({
          api_id: pid,
          api_key: apiKey.trim(),
          base_url_override: baseUrl || undefined,
        });
      }
      setCreds((s) => ({
        ...s,
        [pid]: { ...s[pid], has_key: !!(apiKey?.trim() || s[pid]?.has_key), base_url: baseUrl ?? s[pid]?.base_url },
      }));
      window.__apiToast?.(t('components.model_config_intercept.toast.api_key_saved'), { kind: 'ok', duration: 1800 });
      onSaved && onSaved(pid);
    } catch (e) {
      window.__apiToast?.(t('components.model_config_intercept.toast.save_failed'), { kind: 'danger', detail: e?.message });
    } finally {
      setSaving(false);
    }
  };

  const provider = providers.find((p) => p.id === providerId) || providers[0] || null;
  if (!provider) return null;
  const providerOptions = providers.map((p) => ({ value: p.id, label: p.name }));

  return (
    <CSSpaceBetween size="s">
      <CSFormField label={t('components.model_config_intercept.provider_label')} description={t('components.model_config_intercept.provider_desc', { cap: t(`components.model_config_intercept.cap.${capability}`) })}>
        <CSSelect
          selectedOption={providerOptions.find((o) => o.value === providerId) || null}
          options={providerOptions}
          onChange={({ detail }) => setProviderId(detail.selectedOption.value)}
        />
      </CSFormField>
      <ProviderCard
        provider={provider}
        cred={creds[provider.id] || {}}
        isSaving={saving}
        alibabaMode={alibabaMode}
        onSaveKey={onSaveKey}
        onAlibabaMode={(v) => {
          setAlibabaMode(v);
          window.api.models.upsertApi({
            api_id: 'dashscope',
            kind: 'openai_compat',
            base_url: v === 'openai_compat'
              ? 'https://dashscope.aliyuncs.com/compatible-mode/v1'
              : 'https://dashscope.aliyuncs.com/api/v1',
          }).catch(() => {});
        }}
      />
    </CSSpaceBetween>
  );
}

/* ModelConfigInterceptModal —— config_card 的 hard 拦截弹窗(mode==="model_not_configured")。
   后端要求的模型「<item.model>」当前不可用 → 阻塞式弹窗,用户二选一:
     (a) 给该能力另选一个已配好的模型(内嵌 AgentModelPicker,选中即持久化偏好);或
     (b) 给该模型所属 provider 补一把 API Key(打开 EditApiModal,保存即 credentials.set + 广播刷新)。
   两条路都支持,用户自选。
   确认(继续)→ onResolve(chosenModel) 让父组件 clearQuestions(item) + startRun(`用 X 生成`) 重试。
   取消 → onCancel(item) 仍要 clearQuestions(别把卡片永久卡在 composer)+ 一个「已取消」toast。

   props:
     open        : boolean
     item        : config_card 条目(含 capability / model / api_id)
     onResolve   : (chosenModel:string) => void   选好模型/配好 key 后点「继续生成」
     onCancel    : () => void                       取消(父组件负责 clearQuestions + toast) */
export default function ModelConfigInterceptModal({ open, item, onResolve, onCancel }) {
  const { useState, useEffect } = React;
  const { t } = useTranslation();
  const capability = (item && item.capability) || 'llm';
  const cap = capConfig(capability);
  // 用户在本能力下当前选定的模型(AgentModelPicker onChange 回填);默认沿用后端要求的 model。
  const [chosen, setChosen] = useState({ api_id: (item && item.api_id) || '', model: (item && item.model) || '' });
  const [tab, setTab] = useState('pick');     // pick = 选已有模型 / key = 补 provider key
  const [editKeyOpen, setEditKeyOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [keyError, setKeyError] = useState('');

  // 每次打开/换 item 时重置(避免上一个 config_card 的残留选择)。
  useEffect(() => {
    if (!open) return;
    setChosen({ api_id: (item && item.api_id) || '', model: (item && item.model) || '' });
    setTab('pick');
    setEditKeyOpen(false);
    setKeyError('');
  }, [open, item]);

  if (!open || !item) return null;

  const requestedModel = (item && item.model) || '';
  // EditApiModal 用 api 对象预填 provider(item.api_id 即 provider id);没有就走「新增」自由选。
  const prefillApi = item && item.api_id
    ? { id: item.api_id, name: item.api_id, base_url: '', kind: item.api_id === 'vertex_ai' ? 'vertex_ai' : undefined }
    : null;

  const onConfirmKey = async (form) => {
    setSaving(true); setKeyError('');
    try {
      await window.api.credentials.set({
        api_id: form.id,
        api_key: form.api_key,
        base_url_override: form.base_url || undefined,
      });
      // credentials.set 内部已广播 rpg-credentials-updated → AgentModelPicker 会重拉。
      setEditKeyOpen(false);
      setTab('pick');   // 配好 key 后切回「选模型」,让用户确认要用的模型
      window.__apiToast?.(t('components.model_config_intercept.toast.api_key_saved'), { kind: 'ok', duration: 1800 });
    } catch (e) {
      setKeyError(String(e?.message || e || t('components.model_config_intercept.toast.save_failed')));
    } finally {
      setSaving(false);
    }
  };

  const canContinue = !!(chosen.api_id && chosen.model);

  return (
    <CSModal
      visible
      onDismiss={() => onCancel && onCancel()}
      header={t('components.model_config_intercept.header', { model: requestedModel || '?' })}
      footer={
        <CSBox float="right">
          <CSSpaceBetween direction="horizontal" size="xs">
            <CSButton variant="link" onClick={() => onCancel && onCancel()}>{t('common.cancel')}</CSButton>
            <CSButton
              variant="primary"
              disabled={!canContinue}
              onClick={() => onResolve && onResolve(chosen.model || requestedModel)}
            >
              {t('components.model_config_intercept.continue_btn')}
            </CSButton>
          </CSSpaceBetween>
        </CSBox>
      }
    >
      <CSSpaceBetween size="m">
        <CSAlert type="info">
          {t('components.model_config_intercept.alert', { cap: t(`components.model_config_intercept.cap.${capability}`), model: requestedModel || '?' })}
        </CSAlert>

        <CSSegmentedControl
          selectedId={tab}
          onChange={({ detail }) => setTab(detail.selectedId)}
          options={[
            { id: 'pick', text: t('components.model_config_intercept.tab_pick') },
            { id: 'key', text: t('components.model_config_intercept.tab_key') },
          ]}
        />

        {tab === 'pick' && (
          <AgentModelPicker
            prefPrefix={cap.prefPrefix}
            capabilityFilter={cap.capabilityFilter}
            variant="bare"
            preferProvider={item.api_id || null}
            defaultModel={requestedModel || null}
            configHash="settings-models"
            onChange={(api_id, model) => setChosen({ api_id, model })}
          />
        )}

        {tab === 'key' && (
          <CSSpaceBetween size="s">
            <CSBox color="text-body-secondary" fontSize="body-s">
              {t('components.model_config_intercept.key_tab_hint')}
            </CSBox>
            {/* 就地内联凭据表单(复用设置页 ProviderCard);保存后切回「选模型」 */}
            <InlineProviderConfig
              capability={capability}
              defaultApiId={(item && item.api_id) || ''}
              onSaved={() => setTab('pick')}
            />
          </CSSpaceBetween>
        )}
      </CSSpaceBetween>
    </CSModal>
  );
}

/* CanonEntityEditorView — inline table editor for kb_canon_entities.
   No modal dialogs. SplitPanel for detail. Inline confirmation for delete.
   AWS Cloudscape Design System throughout. */

import React from 'react';
import { useTranslation } from 'react-i18next';

import CSHeader from '@cloudscape-design/components/header';
import CSTable from '@cloudscape-design/components/table';
import CSContainer from '@cloudscape-design/components/container';
import CSSpaceBetween from '@cloudscape-design/components/space-between';
import CSButton from '@cloudscape-design/components/button';
import CSBox from '@cloudscape-design/components/box';
import CSBadge from '@cloudscape-design/components/badge';
import CSAlert from '@cloudscape-design/components/alert';
import CSInput from '@cloudscape-design/components/input';
import CSSelect from '@cloudscape-design/components/select';
import CSTextFilter from '@cloudscape-design/components/text-filter';
import CSSplitPanel from '@cloudscape-design/components/split-panel';
import CSTokenGroup from '@cloudscape-design/components/token-group';
import CSExpandableSection from '@cloudscape-design/components/expandable-section';
import CSFormField from '@cloudscape-design/components/form-field';
import CSTextarea from '@cloudscape-design/components/textarea';
import CSKeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import CSStatusIndicator from '@cloudscape-design/components/status-indicator';
import CSSegmentedControl from '@cloudscape-design/components/segmented-control';

/* ------------------------------------------------------------------ */
/* Constants                                                             */
/* ------------------------------------------------------------------ */
const ENTITY_TYPES = ['character', 'faction', 'location', 'item', 'concept'];
const IMPORTANCE_OPTIONS = [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }));
const STORY_PHASES = ['开端', '发展', '高潮', '结局', '番外', '未明'];

/* ------------------------------------------------------------------ */
/* Helpers                                                               */
/* ------------------------------------------------------------------ */
function snippet(s, len = 50) {
  if (!s) return '—';
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > len ? t.slice(0, len) + '…' : t;
}

/* ------------------------------------------------------------------ */
/* CanonEntityEditorView                                                 */
/* ------------------------------------------------------------------ */
export function CanonEntityEditorView({ scriptId, ownerId, currentUserId }) {
  const { t } = useTranslation();
  const readonly = ownerId != null && currentUserId != null && ownerId !== currentUserId;

  /* data */
  const [items, setItems] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [reloadTick, setReloadTick] = React.useState(0);

  /* filters */
  const [typeFilter, setTypeFilter] = React.useState('all');
  const [query, setQuery] = React.useState('');
  const [sortDesc, setSortDesc] = React.useState(true);

  /* selection / split panel */
  const [selected, setSelected] = React.useState(null); // entity object
  const [splitOpen, setSplitOpen] = React.useState(false);

  /* inline edit state — map of logical_key → { field: pendingValue } */
  const [editCell, setEditCell] = React.useState(null); // { key, field, value }

  /* new entity form */
  const [adding, setAdding] = React.useState(false);
  const [newForm, setNewForm] = React.useState({ logical_key: '', name: '', type: 'character', entity_subtype: '', importance: '3', summary: '' });

  /* delete confirmation inline */
  const [confirmDelete, setConfirmDelete] = React.useState(null); // logical_key

  /* detail panel edit */
  const [detailEdit, setDetailEdit] = React.useState({}); // pending field values for selected entity
  const [savingDetail, setSavingDetail] = React.useState(false);

  /* ---- fetch ---- */
  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ limit: 500 });
    if (typeFilter && typeFilter !== 'all') params.set('type', typeFilter);
    const url = `${window.__API_BASE || ''}/api/scripts/${scriptId}/canon-entities?${params}`;
    fetch(url, { credentials: 'include' })
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setItems(Array.isArray(j) ? j : (j?.items || [])); })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scriptId, typeFilter, reloadTick]);

  /* ---- derived ---- */
  const filtered = React.useMemo(() => {
    let list = items;
    if (query) {
      const q = query.toLowerCase();
      list = list.filter((e) =>
        (e.name || '').toLowerCase().includes(q) ||
        (e.logical_key || '').toLowerCase().includes(q) ||
        (e.entity_subtype || '').toLowerCase().includes(q)
      );
    }
    list = [...list].sort((a, b) => {
      const ai = a.importance ?? 0;
      const bi = b.importance ?? 0;
      return sortDesc ? bi - ai : ai - bi;
    });
    return list;
  }, [items, query, sortDesc]);

  /* lookup parent name */
  const entityMap = React.useMemo(() => {
    const m = {};
    items.forEach((e) => { m[e.logical_key] = e; });
    return m;
  }, [items]);

  /* parent options for select */
  const parentOptions = React.useMemo(() => {
    const opts = [{ value: '', label: t('scripts.edit.canon.no_parent') }];
    items.forEach((e) => {
      if (!selected || e.logical_key !== selected.logical_key) {
        opts.push({ value: e.logical_key, label: e.name || e.logical_key });
      }
    });
    return opts;
  }, [items, selected]);

  /* ---- API calls ---- */
  async function apiPut(logicalKey, body) {
    const r = await fetch(
      `${window.__API_BASE || ''}/api/scripts/${scriptId}/canon-entities/${encodeURIComponent(logicalKey)}`,
      { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );
    const j = await r.json();
    if (!r.ok || j.ok === false) throw new Error(j.error || j.detail || t('scripts.toast.save_fail'));
    return j;
  }

  async function apiPost(body) {
    const r = await fetch(
      `${window.__API_BASE || ''}/api/scripts/${scriptId}/canon-entities`,
      { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );
    const j = await r.json();
    if (!r.ok || j.ok === false) throw new Error(j.error || j.detail || t('scripts.toast.save_fail'));
    return j;
  }

  async function apiDelete(logicalKey) {
    const r = await fetch(
      `${window.__API_BASE || ''}/api/scripts/${scriptId}/canon-entities/${encodeURIComponent(logicalKey)}`,
      { method: 'DELETE', credentials: 'include' }
    );
    const j = await r.json().catch(() => ({}));
    if (!r.ok && j.ok !== true) throw new Error(j.error || j.detail || t('scripts.toast.delete_fail'));
    return j;
  }

  /* ---- inline cell save ---- */
  async function saveCell(entity, field, value) {
    if (readonly) return;
    const patch = { [field]: field === 'importance' ? (parseInt(value, 10) || null) : value };
    try {
      await apiPut(entity.logical_key, patch);
      setItems((arr) => arr.map((e) => e.logical_key === entity.logical_key ? { ...e, ...patch } : e));
      if (selected?.logical_key === entity.logical_key) setSelected((s) => s ? { ...s, ...patch } : s);
      window.__apiToast?.(t('scripts.toast.saved'), { kind: 'ok', duration: 1500 });
    } catch (e) {
      window.__apiToast?.(t('scripts.toast.save_fail'), { kind: 'danger', detail: e?.message });
    }
    setEditCell(null);
  }

  /* ---- add new entity ---- */
  async function submitAdd() {
    if (readonly) return;
    const body = { ...newForm, importance: parseInt(newForm.importance, 10) || 3 };
    if (!body.logical_key || !body.name) {
      window.__apiToast?.(t('scripts.edit.canon.add_required'), { kind: 'warn' });
      return;
    }
    try {
      await apiPost(body);
      setAdding(false);
      setNewForm({ logical_key: '', name: '', type: 'character', entity_subtype: '', importance: '3', summary: '' });
      setReloadTick((x) => x + 1);
      window.__apiToast?.(t('scripts.edit.canon.add_ok'), { kind: 'ok' });
    } catch (e) {
      window.__apiToast?.(t('scripts.toast.save_fail'), { kind: 'danger', detail: e?.message });
    }
  }

  /* ---- delete ---- */
  async function doDelete(logicalKey) {
    if (readonly) return;
    try {
      await apiDelete(logicalKey);
      setItems((arr) => arr.filter((e) => e.logical_key !== logicalKey));
      if (selected?.logical_key === logicalKey) { setSelected(null); setSplitOpen(false); }
      setConfirmDelete(null);
      window.__apiToast?.(t('scripts.edit.canon.deleted'), { kind: 'ok' });
    } catch (e) {
      window.__apiToast?.(t('scripts.toast.delete_fail'), { kind: 'danger', detail: e?.message });
    }
  }

  /* ---- detail panel save ---- */
  async function saveDetail() {
    if (!selected || readonly) return;
    const patch = { ...detailEdit };
    if ('importance' in patch) patch.importance = parseInt(patch.importance, 10) || null;
    if ('aliases' in patch && typeof patch.aliases === 'string') {
      patch.aliases = patch.aliases.split(',').map((s) => s.trim()).filter(Boolean);
    }
    setSavingDetail(true);
    try {
      await apiPut(selected.logical_key, patch);
      const updated = { ...selected, ...patch };
      setSelected(updated);
      setItems((arr) => arr.map((e) => e.logical_key === selected.logical_key ? updated : e));
      setDetailEdit({});
      window.__apiToast?.(t('scripts.toast.saved'), { kind: 'ok' });
    } catch (e) {
      window.__apiToast?.(t('scripts.toast.save_fail'), { kind: 'danger', detail: e?.message });
    } finally { setSavingDetail(false); }
  }

  /* ---- children lookup ---- */
  function childrenOf(logicalKey) {
    return items.filter((e) => e.parent_logical_key === logicalKey);
  }

  /* ---------------------------------------------------------------- */
  /* Render helpers                                                     */
  /* ---------------------------------------------------------------- */
  function renderTypeFilterControl() {
    const segments = [
      { id: 'all', text: t('scripts.edit.canon.type_all') },
      ...ENTITY_TYPES.map((tp) => ({ id: tp, text: t(`scripts.edit.canon.type_${tp}`) })),
    ];
    return (
      <CSSegmentedControl
        selectedId={typeFilter}
        onChange={({ detail }) => setTypeFilter(detail.selectedId)}
        options={segments}
      />
    );
  }

  /* inline editable cell — name */
  function CellName({ entity }) {
    const editing = editCell?.key === entity.logical_key && editCell?.field === 'name';
    if (editing) {
      return (
        <CSInput
          autoFocus
          value={editCell.value}
          onChange={({ detail }) => setEditCell((c) => ({ ...c, value: detail.value }))}
          onKeyDown={({ detail }) => {
            if (detail.key === 'Enter') saveCell(entity, 'name', editCell.value);
            if (detail.key === 'Escape') setEditCell(null);
          }}
          onBlur={() => saveCell(entity, 'name', editCell.value)}
        />
      );
    }
    return (
      <span
        style={{ cursor: readonly ? 'default' : 'text', borderBottom: readonly ? 'none' : '1px dashed var(--color-border-divider-default, #ccc)' }}
        onClick={() => !readonly && setEditCell({ key: entity.logical_key, field: 'name', value: entity.name || '' })}
      >
        {entity.name || '—'}
      </span>
    );
  }

  /* inline editable cell — importance */
  function CellImportance({ entity }) {
    const editing = editCell?.key === entity.logical_key && editCell?.field === 'importance';
    if (editing) {
      return (
        <CSSelect
          selectedOption={IMPORTANCE_OPTIONS.find((o) => o.value === String(editCell.value)) || null}
          options={IMPORTANCE_OPTIONS}
          onChange={({ detail }) => saveCell(entity, 'importance', detail.selectedOption.value)}
          onBlur={() => setEditCell(null)}
        />
      );
    }
    return (
      <span
        style={{ cursor: readonly ? 'default' : 'pointer', borderBottom: readonly ? 'none' : '1px dashed var(--color-border-divider-default, #ccc)' }}
        onClick={() => !readonly && setEditCell({ key: entity.logical_key, field: 'importance', value: String(entity.importance ?? 3) })}
      >
        {entity.importance ?? '—'}
      </span>
    );
  }

  /* inline editable cell — parent */
  function CellParent({ entity }) {
    const editing = editCell?.key === entity.logical_key && editCell?.field === 'parent_logical_key';
    const parentName = entity.parent_logical_key ? (entityMap[entity.parent_logical_key]?.name || entity.parent_logical_key) : '—';
    if (editing) {
      const curOpt = parentOptions.find((o) => o.value === (editCell.value || '')) || parentOptions[0];
      return (
        <CSSelect
          selectedOption={curOpt}
          options={parentOptions}
          onChange={({ detail }) => saveCell(entity, 'parent_logical_key', detail.selectedOption.value || null)}
          onBlur={() => setEditCell(null)}
        />
      );
    }
    return (
      <span
        style={{ cursor: readonly ? 'default' : 'pointer', borderBottom: readonly ? 'none' : '1px dashed var(--color-border-divider-default, #ccc)' }}
        onClick={() => !readonly && setEditCell({ key: entity.logical_key, field: 'parent_logical_key', value: entity.parent_logical_key || '' })}
      >
        {parentName}
      </span>
    );
  }

  /* inline delete confirmation row */
  function DeleteConfirmRow({ entity }) {
    if (confirmDelete !== entity.logical_key) {
      return (
        <CSButton
          variant="inline-link"
          iconName="remove"
          disabled={readonly}
          onClick={() => setConfirmDelete(entity.logical_key)}
        >
          {t('common.delete')}
        </CSButton>
      );
    }
    return (
      <CSSpaceBetween direction="horizontal" size="xs">
        <CSStatusIndicator type="warning">{t('scripts.edit.canon.confirm_delete')}</CSStatusIndicator>
        <CSButton variant="inline-link" iconName="check" onClick={() => doDelete(entity.logical_key)}>
          {t('common.confirm')}
        </CSButton>
        <CSButton variant="inline-link" iconName="close" onClick={() => setConfirmDelete(null)}>
          {t('common.cancel')}
        </CSButton>
      </CSSpaceBetween>
    );
  }

  /* ---- detail panel ---- */
  function DetailPanel({ entity }) {
    const children = childrenOf(entity.logical_key);
    const parent = entity.parent_logical_key ? entityMap[entity.parent_logical_key] : null;
    const detailVal = (field) => (field in detailEdit ? detailEdit[field] : entity[field]);
    const setDF = (field, val) => setDetailEdit((d) => ({ ...d, [field]: val }));
    const isDirty = Object.keys(detailEdit).length > 0;

    const aliases = detailVal('aliases');
    const aliasTokens = Array.isArray(aliases)
      ? aliases.map((a) => ({ label: a, dismissLabel: `Remove ${a}` }))
      : [];

    return (
      <CSSpaceBetween size="m">
        {readonly && (
          <CSAlert type="info" header={t('scripts.edit.readonly_title')}>{t('scripts.edit.readonly_body')}</CSAlert>
        )}

        <CSKeyValuePairs columns={2} items={[
          { label: t('scripts.edit.canon.field_logical_key'), value: <span className="mono">{entity.logical_key}</span> },
          { label: t('scripts.edit.canon.field_type'), value: <CSBadge color={typeBadgeColor(entity.type)}>{t(`scripts.edit.canon.type_${entity.type}`) || entity.type}</CSBadge> },
          { label: t('scripts.edit.canon.field_subtype'), value: entity.entity_subtype || '—' },
          { label: t('scripts.edit.canon.field_importance'), value: entity.importance ?? '—' },
          { label: t('scripts.edit.canon.field_first_chapter'), value: entity.first_revealed_chapter ?? '—' },
        ]} />

        <CSFormField label={t('scripts.edit.canon.field_name')}>
          <CSInput disabled={readonly} value={detailVal('name') || ''} onChange={({ detail }) => setDF('name', detail.value)} />
        </CSFormField>

        <CSFormField label={t('scripts.edit.canon.field_identity')}>
          <CSInput disabled={readonly} value={detailVal('identity') || ''} onChange={({ detail }) => setDF('identity', detail.value)} />
        </CSFormField>

        <CSFormField label={t('scripts.edit.canon.field_summary')}>
          <CSTextarea disabled={readonly} rows={3} value={detailVal('summary') || ''} onChange={({ detail }) => setDF('summary', detail.value)} />
        </CSFormField>

        <CSFormField label={t('scripts.edit.canon.field_background')}>
          <CSTextarea disabled={readonly} rows={4} value={detailVal('background') || ''} onChange={({ detail }) => setDF('background', detail.value)} />
        </CSFormField>

        <CSFormField label={t('scripts.edit.canon.field_aliases')}>
          <CSTokenGroup
            readOnly={readonly}
            items={aliasTokens}
            onDismiss={({ detail }) => {
              const updated = aliasTokens.filter((_, i) => i !== detail.itemIndex).map((t) => t.label);
              setDF('aliases', updated);
            }}
            i18nStrings={{ removeButtonAriaLabel: (t) => `Remove ${t.label}` }}
          />
          {!readonly && (
            <div style={{ marginTop: 6 }}>
              <AddAliasInput
                onAdd={(alias) => {
                  const current = Array.isArray(detailVal('aliases')) ? detailVal('aliases') : (Array.isArray(entity.aliases) ? entity.aliases : []);
                  if (alias && !current.includes(alias)) setDF('aliases', [...current, alias]);
                }}
              />
            </div>
          )}
        </CSFormField>

        {/* Tree view: parent → entity → children */}
        <CSExpandableSection headerText={t('scripts.edit.canon.tree_view')} defaultExpanded={false}>
          <CSSpaceBetween size="xs">
            {parent && (
              <div style={{ paddingLeft: 0 }}>
                <CSBox fontSize="body-s" color="text-body-secondary">
                  ↑ {t('scripts.edit.canon.parent')}: <strong>{parent.name || parent.logical_key}</strong>
                  {parent.entity_subtype ? ` (${parent.entity_subtype})` : ''}
                </CSBox>
              </div>
            )}
            <div style={{ paddingLeft: 16, borderLeft: '2px solid var(--color-border-divider-default, #ccc)' }}>
              <CSBox fontWeight="bold">{entity.name || entity.logical_key}</CSBox>
              <CSBox fontSize="body-s" color="text-body-secondary">
                {t(`scripts.edit.canon.type_${entity.type}`) || entity.type}
                {entity.entity_subtype ? ` · ${entity.entity_subtype}` : ''}
              </CSBox>
            </div>
            {children.length > 0 && (
              <div style={{ paddingLeft: 32 }}>
                <CSBox fontSize="body-s" color="text-body-secondary">
                  ↓ {t('scripts.edit.canon.children')} ({children.length}):
                </CSBox>
                {children.map((ch) => (
                  <div key={ch.logical_key} style={{ paddingLeft: 8 }}>
                    <CSBox fontSize="body-s">
                      • <strong>{ch.name || ch.logical_key}</strong>
                      {ch.entity_subtype ? ` (${ch.entity_subtype})` : ''}
                    </CSBox>
                  </div>
                ))}
              </div>
            )}
          </CSSpaceBetween>
        </CSExpandableSection>

        {!readonly && isDirty && (
          <CSSpaceBetween direction="horizontal" size="xs">
            <CSButton variant="primary" loading={savingDetail} onClick={saveDetail}>
              {t('common.save')}
            </CSButton>
            <CSButton variant="link" onClick={() => setDetailEdit({})}>
              {t('common.cancel')}
            </CSButton>
          </CSSpaceBetween>
        )}
      </CSSpaceBetween>
    );
  }

  /* ---- new entity add row form ---- */
  function AddEntityForm() {
    return (
      <div style={{ padding: '12px 16px', background: 'var(--color-background-container-content)', border: '1px solid var(--color-border-container-top)', borderRadius: 8, marginBottom: 8 }}>
        <CSBox variant="h3" padding={{ bottom: 's' }}>{t('scripts.edit.canon.add_title')}</CSBox>
        <CSSpaceBetween direction="horizontal" size="s">
          <CSFormField label={t('scripts.edit.canon.field_logical_key')}>
            <CSInput
              placeholder="hero_01"
              value={newForm.logical_key}
              onChange={({ detail }) => setNewForm((f) => ({ ...f, logical_key: detail.value }))}
            />
          </CSFormField>
          <CSFormField label={t('scripts.edit.canon.field_name')}>
            <CSInput
              placeholder={t('scripts.edit.canon.field_name_ph')}
              value={newForm.name}
              onChange={({ detail }) => setNewForm((f) => ({ ...f, name: detail.value }))}
            />
          </CSFormField>
          <CSFormField label={t('scripts.edit.canon.field_type')}>
            <CSSelect
              selectedOption={ENTITY_TYPES.map((tp) => ({ value: tp, label: t(`scripts.edit.canon.type_${tp}`) })).find((o) => o.value === newForm.type) || null}
              options={ENTITY_TYPES.map((tp) => ({ value: tp, label: t(`scripts.edit.canon.type_${tp}`) }))}
              onChange={({ detail }) => setNewForm((f) => ({ ...f, type: detail.selectedOption.value }))}
            />
          </CSFormField>
          <CSFormField label={t('scripts.edit.canon.field_subtype')}>
            <CSInput
              placeholder="国家/军队/宗门"
              value={newForm.entity_subtype}
              onChange={({ detail }) => setNewForm((f) => ({ ...f, entity_subtype: detail.value }))}
            />
          </CSFormField>
          <CSFormField label={t('scripts.edit.canon.field_importance')}>
            <CSSelect
              selectedOption={IMPORTANCE_OPTIONS.find((o) => o.value === newForm.importance) || IMPORTANCE_OPTIONS[2]}
              options={IMPORTANCE_OPTIONS}
              onChange={({ detail }) => setNewForm((f) => ({ ...f, importance: detail.selectedOption.value }))}
            />
          </CSFormField>
        </CSSpaceBetween>
        <CSFormField label={t('scripts.edit.canon.field_summary')}>
          <CSInput
            placeholder={t('scripts.edit.canon.field_summary_ph')}
            value={newForm.summary}
            onChange={({ detail }) => setNewForm((f) => ({ ...f, summary: detail.value }))}
          />
        </CSFormField>
        <div style={{ marginTop: 10 }}>
          <CSSpaceBetween direction="horizontal" size="xs">
            <CSButton variant="primary" iconName="add-plus" onClick={submitAdd}>{t('scripts.edit.canon.add_confirm')}</CSButton>
            <CSButton variant="link" onClick={() => { setAdding(false); setNewForm({ logical_key: '', name: '', type: 'character', entity_subtype: '', importance: '3', summary: '' }); }}>
              {t('common.cancel')}
            </CSButton>
          </CSSpaceBetween>
        </div>
      </div>
    );
  }

  /* ---- column definitions ---- */
  const columns = [
    {
      id: 'name',
      header: t('scripts.edit.canon.col_name'),
      cell: (e) => <CellName entity={e} />,
      sortingField: 'name',
    },
    {
      id: 'type',
      header: t('scripts.edit.canon.col_type'),
      cell: (e) => <CSBadge color={typeBadgeColor(e.type)}>{t(`scripts.edit.canon.type_${e.type}`) || e.type}</CSBadge>,
    },
    {
      id: 'subtype',
      header: t('scripts.edit.canon.col_subtype'),
      cell: (e) => e.entity_subtype || '—',
    },
    {
      id: 'parent',
      header: t('scripts.edit.canon.col_parent'),
      cell: (e) => <CellParent entity={e} />,
    },
    {
      id: 'importance',
      header: t('scripts.edit.canon.col_importance'),
      cell: (e) => <CellImportance entity={e} />,
    },
    {
      id: 'summary',
      header: t('scripts.edit.canon.col_summary'),
      cell: (e) => <CSBox color="text-body-secondary" fontSize="body-s">{snippet(e.summary, 50)}</CSBox>,
    },
    {
      id: 'actions',
      header: '',
      cell: (e) => (
        <CSSpaceBetween direction="horizontal" size="xxs">
          <CSButton
            variant="inline-link"
            iconName="search"
            onClick={() => { setSelected(e); setDetailEdit({}); setSplitOpen(true); }}
          >
            {t('scripts.edit.canon.view_detail')}
          </CSButton>
          <DeleteConfirmRow entity={e} />
        </CSSpaceBetween>
      ),
    },
  ];

  /* ---- main render ---- */
  const tableEl = (
    <CSTable
      variant="container"
      loading={loading}
      loadingText={t('scripts.edit.canon.loading')}
      items={filtered}
      trackBy="logical_key"
      selectionType="single"
      selectedItems={selected ? [selected] : []}
      onSelectionChange={({ detail }) => {
        const e = detail.selectedItems[0];
        if (e) { setSelected(e); setDetailEdit({}); setSplitOpen(true); }
      }}
      columnDefinitions={columns}
      header={
        <CSHeader
          variant="h2"
          counter={`(${filtered.length})`}
          actions={
            <CSSpaceBetween direction="horizontal" size="xs">
              <CSButton
                iconName={sortDesc ? 'sort-descending' : 'sort-ascending'}
                variant="icon"
                ariaLabel={t('scripts.edit.canon.sort_importance')}
                onClick={() => setSortDesc((v) => !v)}
              />
              <CSButton iconName="refresh" variant="icon" ariaLabel={t('common.refresh')} onClick={() => setReloadTick((x) => x + 1)} />
              {!readonly && (
                <CSButton iconName="add-plus" variant="primary" onClick={() => setAdding((v) => !v)}>
                  {t('scripts.edit.canon.add_btn')}
                </CSButton>
              )}
            </CSSpaceBetween>
          }
          description={t('scripts.edit.canon.description')}
        >
          {t('scripts.edit.canon.title')}
        </CSHeader>
      }
      filter={
        <CSSpaceBetween direction="horizontal" size="s">
          {renderTypeFilterControl()}
          <CSTextFilter
            filteringText={query}
            filteringPlaceholder={t('scripts.edit.canon.search_ph')}
            onChange={({ detail }) => setQuery(detail.filteringText)}
          />
        </CSSpaceBetween>
      }
      empty={
        <CSBox textAlign="center" color="inherit" padding={{ vertical: 'l' }}>
          {query ? t('scripts.edit.canon.empty_search') : t('scripts.edit.canon.empty')}
        </CSBox>
      }
    />
  );

  return (
    <CSSpaceBetween size="m">
      {readonly && (
        <CSAlert type="info" header={t('scripts.edit.readonly_title')}>
          {t('scripts.edit.readonly_body')}
        </CSAlert>
      )}
      {adding && !readonly && <AddEntityForm />}
      {splitOpen && selected ? (
        <CSSplitPanel
          header={selected.name || selected.logical_key}
          i18nStrings={{
            closeButtonAriaLabel: t('common.close'),
            openButtonAriaLabel: t('scripts.edit.canon.open_detail'),
            preferencesTitle: t('scripts.edit.canon.panel_prefs'),
            preferencesPositionLabel: t('scripts.edit.canon.panel_pos'),
            preferencesPositionSide: t('scripts.edit.canon.panel_side'),
            preferencesPositionBottom: t('scripts.edit.canon.panel_bottom'),
            preferencesConfirm: t('common.confirm'),
            preferencesCancel: t('common.cancel'),
            resizeHandleAriaLabel: t('scripts.edit.canon.resize_handle'),
          }}
        >
          <DetailPanel entity={selected} />
        </CSSplitPanel>
      ) : null}
      {tableEl}
    </CSSpaceBetween>
  );
}

/* ------------------------------------------------------------------ */
/* Helper: AddAliasInput                                                */
/* ------------------------------------------------------------------ */
function AddAliasInput({ onAdd }) {
  const { t } = useTranslation();
  const [val, setVal] = React.useState('');
  return (
    <CSSpaceBetween direction="horizontal" size="xs">
      <CSInput
        placeholder={t('scripts.edit.canon.alias_ph')}
        value={val}
        onChange={({ detail }) => setVal(detail.value)}
        onKeyDown={({ detail }) => { if (detail.key === 'Enter' && val.trim()) { onAdd(val.trim()); setVal(''); } }}
      />
      <CSButton
        iconName="add-plus"
        variant="icon"
        ariaLabel={t('scripts.edit.canon.alias_add')}
        disabled={!val.trim()}
        onClick={() => { onAdd(val.trim()); setVal(''); }}
      />
    </CSSpaceBetween>
  );
}

/* ------------------------------------------------------------------ */
/* Helper: badge color mapping                                          */
/* ------------------------------------------------------------------ */
function typeBadgeColor(type) {
  switch (type) {
    case 'character': return 'blue';
    case 'faction':   return 'green';
    case 'location':  return 'grey';
    case 'item':      return 'red';
    case 'concept':   return 'severity-neutral';
    default:          return 'grey';
  }
}

/* ------------------------------------------------------------------ */
/* AnchorEditorView                                                      */
/* ------------------------------------------------------------------ */
export function AnchorEditorView({ scriptId, ownerId, currentUserId }) {
  const { t } = useTranslation();
  const readonly = ownerId != null && currentUserId != null && ownerId !== currentUserId;

  /* data */
  const [items, setItems] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [reloadTick, setReloadTick] = React.useState(0);

  /* filters */
  const [phaseFilter, setPhaseFilter] = React.useState('all');
  const [chapterMin, setChapterMin] = React.useState('');
  const [chapterMax, setChapterMax] = React.useState('');

  /* selection / detail */
  const [selected, setSelected] = React.useState(null);
  const [splitOpen, setSplitOpen] = React.useState(false);
  const [detailEdit, setDetailEdit] = React.useState({});
  const [savingDetail, setSavingDetail] = React.useState(false);

  /* inline edit */
  const [editCell, setEditCell] = React.useState(null); // { id, field, value }

  /* add new */
  const [adding, setAdding] = React.useState(false);
  const [newForm, setNewForm] = React.useState({ story_phase: '开端', story_time_label: '', chapter_min: '', chapter_max: '', confidence: '0.8', sample_summary: '' });

  /* delete confirm inline */
  const [confirmDelete, setConfirmDelete] = React.useState(null); // anchor id

  /* ---- fetch ---- */
  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams();
    if (phaseFilter && phaseFilter !== 'all') params.set('phase', phaseFilter);
    if (chapterMin) params.set('chapter_min', chapterMin);
    if (chapterMax) params.set('chapter_max', chapterMax);
    const url = `${window.__API_BASE || ''}/api/scripts/${scriptId}/anchors?${params}`;
    fetch(url, { credentials: 'include' })
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setItems(Array.isArray(j) ? j : (j?.items || j?.anchors || [])); })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scriptId, phaseFilter, chapterMin, chapterMax, reloadTick]);

  /* ---- API ---- */
  async function apiPut(anchorId, body) {
    const r = await fetch(
      `${window.__API_BASE || ''}/api/scripts/${scriptId}/anchors/${encodeURIComponent(anchorId)}`,
      { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );
    const j = await r.json();
    if (!r.ok || j.ok === false) throw new Error(j.error || j.detail || t('scripts.toast.save_fail'));
    return j;
  }

  async function apiPost(body) {
    const r = await fetch(
      `${window.__API_BASE || ''}/api/scripts/${scriptId}/anchors`,
      { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );
    const j = await r.json();
    if (!r.ok || j.ok === false) throw new Error(j.error || j.detail || t('scripts.toast.save_fail'));
    return j;
  }

  async function apiDelete(anchorId) {
    const r = await fetch(
      `${window.__API_BASE || ''}/api/scripts/${scriptId}/anchors/${encodeURIComponent(anchorId)}`,
      { method: 'DELETE', credentials: 'include' }
    );
    const j = await r.json().catch(() => ({}));
    if (!r.ok && j.ok !== true) throw new Error(j.error || j.detail || t('scripts.toast.delete_fail'));
    return j;
  }

  /* ---- inline cell save ---- */
  async function saveCell(anchor, field, value) {
    if (readonly) return;
    const patch = { [field]: field === 'confidence' ? (parseFloat(value) || null) : value };
    try {
      await apiPut(anchor.id, patch);
      setItems((arr) => arr.map((a) => a.id === anchor.id ? { ...a, ...patch } : a));
      if (selected?.id === anchor.id) setSelected((s) => s ? { ...s, ...patch } : s);
      window.__apiToast?.(t('scripts.toast.saved'), { kind: 'ok', duration: 1500 });
    } catch (e) {
      window.__apiToast?.(t('scripts.toast.save_fail'), { kind: 'danger', detail: e?.message });
    }
    setEditCell(null);
  }

  /* ---- add ---- */
  async function submitAdd() {
    if (readonly) return;
    const body = {
      ...newForm,
      chapter_min: parseInt(newForm.chapter_min, 10) || null,
      chapter_max: parseInt(newForm.chapter_max, 10) || null,
      confidence: parseFloat(newForm.confidence) || 0.8,
    };
    try {
      await apiPost(body);
      setAdding(false);
      setNewForm({ story_phase: '开端', story_time_label: '', chapter_min: '', chapter_max: '', confidence: '0.8', sample_summary: '' });
      setReloadTick((x) => x + 1);
      window.__apiToast?.(t('scripts.edit.anchors.add_ok'), { kind: 'ok' });
    } catch (e) {
      window.__apiToast?.(t('scripts.toast.save_fail'), { kind: 'danger', detail: e?.message });
    }
  }

  /* ---- delete ---- */
  async function doDelete(anchorId) {
    if (readonly) return;
    try {
      await apiDelete(anchorId);
      setItems((arr) => arr.filter((a) => a.id !== anchorId));
      if (selected?.id === anchorId) { setSelected(null); setSplitOpen(false); }
      setConfirmDelete(null);
      window.__apiToast?.(t('scripts.edit.anchors.deleted'), { kind: 'ok' });
    } catch (e) {
      window.__apiToast?.(t('scripts.toast.delete_fail'), { kind: 'danger', detail: e?.message });
    }
  }

  /* ---- detail panel save ---- */
  async function saveDetail() {
    if (!selected || readonly) return;
    const patch = { ...detailEdit };
    if ('confidence' in patch) patch.confidence = parseFloat(patch.confidence) || null;
    setSavingDetail(true);
    try {
      await apiPut(selected.id, patch);
      const updated = { ...selected, ...patch };
      setSelected(updated);
      setItems((arr) => arr.map((a) => a.id === selected.id ? updated : a));
      setDetailEdit({});
      window.__apiToast?.(t('scripts.toast.saved'), { kind: 'ok' });
    } catch (e) {
      window.__apiToast?.(t('scripts.toast.save_fail'), { kind: 'danger', detail: e?.message });
    } finally { setSavingDetail(false); }
  }

  /* ---- phase segment options ---- */
  const phaseOptions = [
    { id: 'all', text: t('scripts.edit.anchors.phase_all') },
    ...STORY_PHASES.map((p) => ({ id: p, text: p })),
  ];

  /* ---- inline editable cells ---- */
  function CellPhase({ anchor }) {
    const editing = editCell?.id === anchor.id && editCell?.field === 'story_phase';
    if (editing) {
      return (
        <CSSelect
          selectedOption={STORY_PHASES.map((p) => ({ value: p, label: p })).find((o) => o.value === editCell.value) || null}
          options={STORY_PHASES.map((p) => ({ value: p, label: p }))}
          onChange={({ detail }) => saveCell(anchor, 'story_phase', detail.selectedOption.value)}
          onBlur={() => setEditCell(null)}
        />
      );
    }
    return (
      <span
        style={{ cursor: readonly ? 'default' : 'pointer', borderBottom: readonly ? 'none' : '1px dashed var(--color-border-divider-default, #ccc)' }}
        onClick={() => !readonly && setEditCell({ id: anchor.id, field: 'story_phase', value: anchor.story_phase || '' })}
      >
        {anchor.story_phase || '—'}
      </span>
    );
  }

  function CellConfidence({ anchor }) {
    const editing = editCell?.id === anchor.id && editCell?.field === 'confidence';
    if (editing) {
      return (
        <CSInput
          autoFocus
          type="number"
          step="0.05"
          value={String(editCell.value)}
          onChange={({ detail }) => setEditCell((c) => ({ ...c, value: detail.value }))}
          onKeyDown={({ detail }) => {
            if (detail.key === 'Enter') saveCell(anchor, 'confidence', editCell.value);
            if (detail.key === 'Escape') setEditCell(null);
          }}
          onBlur={() => saveCell(anchor, 'confidence', editCell.value)}
        />
      );
    }
    const pct = anchor.confidence != null ? `${Math.round(anchor.confidence * 100)}%` : '—';
    const color = anchor.confidence >= 0.85 ? 'var(--color-text-status-success, #1d7649)' : anchor.confidence >= 0.7 ? 'var(--color-text-status-warning, #b55a00)' : 'var(--color-text-status-error, #d63f38)';
    return (
      <span
        style={{ cursor: readonly ? 'default' : 'pointer', borderBottom: readonly ? 'none' : '1px dashed var(--color-border-divider-default, #ccc)', color, fontVariantNumeric: 'tabular-nums' }}
        onClick={() => !readonly && setEditCell({ id: anchor.id, field: 'confidence', value: String(anchor.confidence ?? 0.8) })}
      >
        {pct}
      </span>
    );
  }

  function DeleteConfirmRow({ anchor }) {
    if (confirmDelete !== anchor.id) {
      return (
        <CSButton variant="inline-link" iconName="remove" disabled={readonly} onClick={() => setConfirmDelete(anchor.id)}>
          {t('common.delete')}
        </CSButton>
      );
    }
    return (
      <CSSpaceBetween direction="horizontal" size="xs">
        <CSStatusIndicator type="warning">{t('scripts.edit.anchors.confirm_delete')}</CSStatusIndicator>
        <CSButton variant="inline-link" iconName="check" onClick={() => doDelete(anchor.id)}>{t('common.confirm')}</CSButton>
        <CSButton variant="inline-link" iconName="close" onClick={() => setConfirmDelete(null)}>{t('common.cancel')}</CSButton>
      </CSSpaceBetween>
    );
  }

  /* ---- detail panel ---- */
  function DetailPanel({ anchor }) {
    const detailVal = (field) => (field in detailEdit ? detailEdit[field] : anchor[field]);
    const setDF = (field, val) => setDetailEdit((d) => ({ ...d, [field]: val }));
    const isDirty = Object.keys(detailEdit).length > 0;
    let metaDisplay = '—';
    try {
      const m = anchor.metadata;
      if (m && typeof m === 'object') metaDisplay = JSON.stringify(m, null, 2);
      else if (m) metaDisplay = String(m);
    } catch (_) {}

    return (
      <CSSpaceBetween size="m">
        {readonly && (
          <CSAlert type="info" header={t('scripts.edit.readonly_title')}>{t('scripts.edit.readonly_body')}</CSAlert>
        )}

        <CSKeyValuePairs columns={2} items={[
          { label: t('scripts.edit.anchors.field_id'), value: <span className="mono">{anchor.id}</span> },
          { label: t('scripts.edit.anchors.field_phase'), value: anchor.story_phase || '—' },
          { label: t('scripts.edit.anchors.field_time_label'), value: anchor.story_time_label || '—' },
          { label: t('scripts.edit.anchors.field_chapter_range'), value: `${anchor.chapter_min ?? '?'} – ${anchor.chapter_max ?? '?'}` },
          { label: t('scripts.edit.anchors.field_confidence'), value: anchor.confidence != null ? `${Math.round(anchor.confidence * 100)}%` : '—' },
        ]} />

        <CSFormField label={t('scripts.edit.anchors.field_sample_summary')}>
          <CSTextarea
            disabled={readonly}
            rows={5}
            value={detailVal('sample_summary') || ''}
            onChange={({ detail }) => setDF('sample_summary', detail.value)}
          />
        </CSFormField>

        <CSExpandableSection headerText={t('scripts.edit.anchors.field_metadata')} defaultExpanded={false}>
          <pre style={{
            margin: 0, padding: '10px 12px',
            background: 'var(--color-background-container-content)',
            border: '1px solid var(--color-border-divider-default)',
            borderRadius: 6, fontSize: 12, lineHeight: 1.6, overflow: 'auto', maxHeight: 200,
            fontFamily: 'var(--font-family-monospace, monospace)', whiteSpace: 'pre-wrap',
          }}>
            {metaDisplay}
          </pre>
        </CSExpandableSection>

        {!readonly && isDirty && (
          <CSSpaceBetween direction="horizontal" size="xs">
            <CSButton variant="primary" loading={savingDetail} onClick={saveDetail}>
              {t('common.save')}
            </CSButton>
            <CSButton variant="link" onClick={() => setDetailEdit({})}>
              {t('common.cancel')}
            </CSButton>
          </CSSpaceBetween>
        )}
      </CSSpaceBetween>
    );
  }

  /* ---- add form ---- */
  function AddAnchorForm() {
    return (
      <div style={{ padding: '12px 16px', background: 'var(--color-background-container-content)', border: '1px solid var(--color-border-container-top)', borderRadius: 8, marginBottom: 8 }}>
        <CSBox variant="h3" padding={{ bottom: 's' }}>{t('scripts.edit.anchors.add_title')}</CSBox>
        <CSSpaceBetween direction="horizontal" size="s">
          <CSFormField label={t('scripts.edit.anchors.field_phase')}>
            <CSSelect
              selectedOption={STORY_PHASES.map((p) => ({ value: p, label: p })).find((o) => o.value === newForm.story_phase) || null}
              options={STORY_PHASES.map((p) => ({ value: p, label: p }))}
              onChange={({ detail }) => setNewForm((f) => ({ ...f, story_phase: detail.selectedOption.value }))}
            />
          </CSFormField>
          <CSFormField label={t('scripts.edit.anchors.field_time_label')}>
            <CSInput
              placeholder={t('scripts.edit.anchors.time_label_ph')}
              value={newForm.story_time_label}
              onChange={({ detail }) => setNewForm((f) => ({ ...f, story_time_label: detail.value }))}
            />
          </CSFormField>
          <CSFormField label={t('scripts.edit.anchors.field_chapter_min')}>
            <CSInput
              type="number"
              value={newForm.chapter_min}
              onChange={({ detail }) => setNewForm((f) => ({ ...f, chapter_min: detail.value }))}
            />
          </CSFormField>
          <CSFormField label={t('scripts.edit.anchors.field_chapter_max')}>
            <CSInput
              type="number"
              value={newForm.chapter_max}
              onChange={({ detail }) => setNewForm((f) => ({ ...f, chapter_max: detail.value }))}
            />
          </CSFormField>
          <CSFormField label={t('scripts.edit.anchors.field_confidence')}>
            <CSInput
              type="number"
              step="0.05"
              value={newForm.confidence}
              onChange={({ detail }) => setNewForm((f) => ({ ...f, confidence: detail.value }))}
            />
          </CSFormField>
        </CSSpaceBetween>
        <CSFormField label={t('scripts.edit.anchors.field_sample_summary')}>
          <CSInput
            placeholder={t('scripts.edit.anchors.summary_ph')}
            value={newForm.sample_summary}
            onChange={({ detail }) => setNewForm((f) => ({ ...f, sample_summary: detail.value }))}
          />
        </CSFormField>
        <div style={{ marginTop: 10 }}>
          <CSSpaceBetween direction="horizontal" size="xs">
            <CSButton variant="primary" iconName="add-plus" onClick={submitAdd}>{t('scripts.edit.anchors.add_confirm')}</CSButton>
            <CSButton variant="link" onClick={() => setAdding(false)}>{t('common.cancel')}</CSButton>
          </CSSpaceBetween>
        </div>
      </div>
    );
  }

  /* ---- column definitions ---- */
  const columns = [
    {
      id: 'chapter_range',
      header: t('scripts.edit.anchors.col_chapter_range'),
      cell: (a) => (
        <span className="mono" style={{ fontSize: 12.5 }}>
          {a.chapter_min ?? '?'}–{a.chapter_max ?? '?'}
        </span>
      ),
    },
    {
      id: 'phase',
      header: t('scripts.edit.anchors.col_phase'),
      cell: (a) => <CellPhase anchor={a} />,
    },
    {
      id: 'time_label',
      header: t('scripts.edit.anchors.col_time_label'),
      cell: (a) => a.story_time_label || '—',
    },
    {
      id: 'summary',
      header: t('scripts.edit.anchors.col_summary'),
      cell: (a) => <CSBox color="text-body-secondary" fontSize="body-s">{snippet(a.sample_summary, 60)}</CSBox>,
    },
    {
      id: 'confidence',
      header: t('scripts.edit.anchors.col_confidence'),
      cell: (a) => <CellConfidence anchor={a} />,
    },
    {
      id: 'actions',
      header: '',
      cell: (a) => (
        <CSSpaceBetween direction="horizontal" size="xxs">
          <CSButton variant="inline-link" iconName="search" onClick={() => { setSelected(a); setDetailEdit({}); setSplitOpen(true); }}>
            {t('scripts.edit.anchors.view_detail')}
          </CSButton>
          <DeleteConfirmRow anchor={a} />
        </CSSpaceBetween>
      ),
    },
  ];

  /* ---- main render ---- */
  const tableEl = (
    <CSTable
      variant="container"
      loading={loading}
      loadingText={t('scripts.edit.anchors.loading')}
      items={items}
      trackBy="id"
      selectionType="single"
      selectedItems={selected ? [selected] : []}
      onSelectionChange={({ detail }) => {
        const a = detail.selectedItems[0];
        if (a) { setSelected(a); setDetailEdit({}); setSplitOpen(true); }
      }}
      columnDefinitions={columns}
      header={
        <CSHeader
          variant="h2"
          counter={`(${items.length})`}
          actions={
            <CSSpaceBetween direction="horizontal" size="xs">
              <CSButton iconName="refresh" variant="icon" ariaLabel={t('common.refresh')} onClick={() => setReloadTick((x) => x + 1)} />
              {!readonly && (
                <CSButton iconName="add-plus" variant="primary" onClick={() => setAdding((v) => !v)}>
                  {t('scripts.edit.anchors.add_btn')}
                </CSButton>
              )}
            </CSSpaceBetween>
          }
          description={t('scripts.edit.anchors.description')}
        >
          {t('scripts.edit.anchors.title')}
        </CSHeader>
      }
      filter={
        <CSSpaceBetween direction="horizontal" size="s">
          <CSSegmentedControl
            selectedId={phaseFilter}
            onChange={({ detail }) => setPhaseFilter(detail.selectedId)}
            options={phaseOptions}
          />
          <CSSpaceBetween direction="horizontal" size="xs">
            <CSInput
              type="number"
              placeholder={t('scripts.edit.anchors.filter_ch_min')}
              value={chapterMin}
              onChange={({ detail }) => setChapterMin(detail.value)}
              ariaLabel={t('scripts.edit.anchors.filter_ch_min')}
            />
            <CSInput
              type="number"
              placeholder={t('scripts.edit.anchors.filter_ch_max')}
              value={chapterMax}
              onChange={({ detail }) => setChapterMax(detail.value)}
              ariaLabel={t('scripts.edit.anchors.filter_ch_max')}
            />
          </CSSpaceBetween>
        </CSSpaceBetween>
      }
      empty={
        <CSBox textAlign="center" color="inherit" padding={{ vertical: 'l' }}>
          {t('scripts.edit.anchors.empty')}
        </CSBox>
      }
    />
  );

  return (
    <CSSpaceBetween size="m">
      {readonly && (
        <CSAlert type="info" header={t('scripts.edit.readonly_title')}>
          {t('scripts.edit.readonly_body')}
        </CSAlert>
      )}
      {adding && !readonly && <AddAnchorForm />}
      {splitOpen && selected ? (
        <CSSplitPanel
          header={`${selected.story_phase || ''} · ${t('scripts.editor.chapter_range', { min: selected.chapter_min ?? '?', max: selected.chapter_max ?? '?' })}`}
          i18nStrings={{
            closeButtonAriaLabel: t('common.close'),
            openButtonAriaLabel: t('scripts.edit.anchors.open_detail'),
            preferencesTitle: t('scripts.edit.anchors.panel_prefs'),
            preferencesPositionLabel: t('scripts.edit.anchors.panel_pos'),
            preferencesPositionSide: t('scripts.edit.anchors.panel_side'),
            preferencesPositionBottom: t('scripts.edit.anchors.panel_bottom'),
            preferencesConfirm: t('common.confirm'),
            preferencesCancel: t('common.cancel'),
            resizeHandleAriaLabel: t('scripts.edit.anchors.resize_handle'),
          }}
        >
          <DetailPanel anchor={selected} />
        </CSSplitPanel>
      ) : null}
      {tableEl}
    </CSSpaceBetween>
  );
}

/* ModuleMatrixOverview — Editorial × 古籍数字化 重设计版.
   改用 editorial.module.css 网格布局.无 Cloudscape 依赖.
*/

import React from 'react';
import { useTranslation } from 'react-i18next';
import { ModuleStatusCard } from './ModuleStatusCard.jsx';
import s from './editorial.module.css';

const MODULE_ORDER = ['chunks', 'chapter_facts', 'canon', 'cards', 'worldbook', 'anchors', 'embeddings'];

export function ModuleMatrixOverview({ scriptId, status, loading, activeJobId, onRebuild, onViewDetail }) {
  const { t } = useTranslation();
  const modules = (status && status.modules) || {};

  return (
    <div className={s.matrixRoot}>
      <div className={s.matrixHeader}>
        <h3 className={s.matrixTitle}>
          {t('modules.matrix.title', { defaultValue: '模块矩阵' })}
        </h3>
        <p className={s.matrixDesc}>
          {t('modules.matrix.desc', { defaultValue: '剧本所有派生数据的当前状态。每个模块可独立重做。' })}
        </p>
      </div>

      {loading && !status && (
        <div className={s.matrixLoading}>{t('common.loading')}</div>
      )}

      <div className={s.matrixGrid}>
        {MODULE_ORDER.map((mod) => {
          const m = modules[mod] || {};
          return (
            <ModuleStatusCard
              key={mod}
              module={mod}
              scriptId={scriptId}
              status={m.status || 'unknown'}
              doneCount={m.done_count}
              totalCount={m.total_count}
              lastJobId={m.last_job_id}
              lastRebuiltAt={m.last_rebuilt_at}
              source={m.source}
              metadata={m.metadata}
              activeJobId={activeJobId}
              onRebuild={onRebuild}
              onViewDetail={onViewDetail}
            />
          );
        })}
      </div>
    </div>
  );
}

export default ModuleMatrixOverview;

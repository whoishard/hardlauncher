import React, { useState } from 'react';
import DOMPurify from 'dompurify';
import FilterDropdown from './FilterDropdown.jsx';
import { useT } from '../i18n.js';

function sanitizeIcon(svg) {
  return DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
}

function groupByHeader(items, otherLabel) {
  const groups = {};
  for (const item of items) {
    const key = item.header || otherLabel;
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }
  return groups;
}

/**
 * Barra de filtros compacta (reemplaza la barra lateral anterior): cada
 * filtro es un botón que abre un menú flotante, así ocupa una sola fila
 * en vez de un panel entero al costado, y su scroll interno no interfiere
 * con el scroll de la página de resultados.
 */
export default function FilterBar({
  projectType,
  allCategories,
  allLoaders,
  allGameVersions,
  categories,
  loaders,
  mcVersions,
  onToggleCategory,
  onToggleLoader,
  onToggleVersion,
  onClear,
}) {
  const [versionQuery, setVersionQuery] = useState('');
  const [showSnapshots, setShowSnapshots] = useState(false);
  const t = useT();

  const relevantCategories = allCategories.filter((c) => c.project_type === projectType);
  const grouped = groupByHeader(relevantCategories, t('filter.other'));
  const showLoaders = projectType === 'mod' || projectType === 'modpack';

  const filteredVersions = allGameVersions
    .filter((v) => showSnapshots || v.version_type === 'release')
    .filter((v) => v.version.toLowerCase().includes(versionQuery.toLowerCase()))
    .slice(0, 60);

  const hasActiveFilters = categories.length > 0 || loaders.length > 0 || mcVersions.length > 0;

  return (
    <div className="filter-bar">
      <FilterDropdown label={t('filter.mcVersion')} count={mcVersions.length}>
        <input
          className="facet-search"
          placeholder={t('filter.searchVersion')}
          value={versionQuery}
          onChange={(e) => setVersionQuery(e.target.value)}
        />
        <label className="facet-row custom-checkbox-row" style={{ marginBottom: 4 }}>
          <input type="checkbox" checked={showSnapshots} onChange={(e) => setShowSnapshots(e.target.checked)} />
          <span className="custom-checkbox-box" />
          {t('filter.snapshots')}
        </label>
        <div className="filter-dropdown-scroll">
          {filteredVersions.map((v) => (
            <label key={v.version} className="facet-row custom-checkbox-row">
              <input type="checkbox" checked={mcVersions.includes(v.version)} onChange={() => onToggleVersion(v.version)} />
              <span className="custom-checkbox-box" />
              {v.version}
            </label>
          ))}
        </div>
      </FilterDropdown>

      {showLoaders && (
        <FilterDropdown label={t('filter.loader')} count={loaders.length} width={220}>
          <div className="filter-dropdown-scroll" style={{ maxHeight: 220 }}>
            {allLoaders
              .filter((l) => l.supported_project_types?.includes(projectType))
              .map((l) => (
                <label key={l.name} className="facet-row custom-checkbox-row">
                  <input type="checkbox" checked={loaders.includes(l.name)} onChange={() => onToggleLoader(l.name)} />
                  <span className="custom-checkbox-box" />
                  {l.icon && <span className="facet-icon" dangerouslySetInnerHTML={{ __html: sanitizeIcon(l.icon) }} />}
                  {l.name.charAt(0).toUpperCase() + l.name.slice(1)}
                </label>
              ))}
          </div>
        </FilterDropdown>
      )}

      <FilterDropdown label={t('filter.categories')} count={categories.length} width={280}>
        <div className="filter-dropdown-scroll" style={{ maxHeight: 320 }}>
          {Object.entries(grouped).map(([header, items]) => (
            <div key={header} className="facet-group">
              <div className="facet-group-title">{header}</div>
              {items.map((c) => (
                <label key={c.name} className="facet-row custom-checkbox-row">
                  <input type="checkbox" checked={categories.includes(c.name)} onChange={() => onToggleCategory(c.name)} />
                  <span className="custom-checkbox-box" />
                  {c.icon && <span className="facet-icon" dangerouslySetInnerHTML={{ __html: sanitizeIcon(c.icon) }} />}
                  {c.name.charAt(0).toUpperCase() + c.name.slice(1).replace(/-/g, ' ')}
                </label>
              ))}
            </div>
          ))}
        </div>
      </FilterDropdown>

      {hasActiveFilters && (
        <button className="clear-filters-btn" onClick={onClear}>
          {t('filter.clear')}
        </button>
      )}
    </div>
  );
}

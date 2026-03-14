// js/ui_filters.js
import { state } from './state.js';
import { refreshViews } from './map.js';
import { updateGlobalStats } from './ui_main.js';

/**
 * Populates the initial geographical and category filters
 */
export function populateFilters() {
    const sites = Object.values(state.mapping);

    // Unique Regions
    const regions = [...new Set(sites.map(s => s.reg_name).filter(Boolean))].sort();
    const regionSelect = document.getElementById('filter-region');
    regions.forEach(reg => {
        const opt = document.createElement('option');
        opt.value = reg;
        opt.textContent = reg;
        regionSelect.appendChild(opt);
    });

    // Unique Categories (Sectors)
    const categories = [...new Set(sites.map(s => s.categorie).filter(Boolean))].sort();
    const sectorSelect = document.getElementById('filter-sector');
    categories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        sectorSelect.appendChild(opt);
    });

    // Departments are populated based on region selection
    updateDeptFilter();

    // Initialize Select2 for top-level filters
    $('#filter-region, #filter-dept, #filter-sector').select2({
        width: '100%',
        minimumResultsForSearch: 10
    });
}

/**
 * Triggered when a filter change occurs
 */
export function applyFilters(event) {
    const regVal = document.getElementById('filter-region').value;
    const sectorVal = document.getElementById('filter-sector').value;

    if (event && event.target && event.target.id === 'filter-region') {
        updateDeptFilter();
    }

    const deptVal = document.getElementById('filter-dept').value;

    state.table.column(4).search(regVal);

    if (deptVal) {
        state.table.column(3).search('^' + deptVal.replace(/-/g, '\\-') + '$', true, false);
    } else {
        state.table.column(3).search('');
    }

    state.table.column(5).search(sectorVal);
    state.table.draw();

    updateGlobalStats();

    $('#filter-dept').trigger('change.select2');

    if (state.currentView === "map") {
        refreshViews();
    }

    // Update comparison if view is open
    // Note: lastComparisonData and renderComparison will be in ui_comparison.js
    // We'll handle this global dependency in ui_main or via a registry
}

/**
 * Updates the department dropdown based on the selected region
 */
export function updateDeptFilter() {
    const selectedRegion = document.getElementById('filter-region').value;
    const sites = Object.values(state.mapping);
    const deptSelect = document.getElementById('filter-dept');

    deptSelect.innerHTML = '<option value="">Tous les départements</option>';

    let filteredDepts = sites;
    if (selectedRegion) {
        filteredDepts = sites.filter(s => s.reg_name === selectedRegion);
    }

    const depts = [...new Set(filteredDepts.map(s => s.dep_name ? `${s.dep_code} - ${s.dep_name}` : s.dep_code))].sort();

    depts.forEach(dept => {
        const opt = document.createElement('option');
        opt.value = dept;
        opt.textContent = dept;
        deptSelect.appendChild(opt);
    });
}

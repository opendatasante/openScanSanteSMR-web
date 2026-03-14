// js/ui_main.js
import { state } from './state.js';
import { populateFilters, applyFilters, updateDeptFilter } from './ui_filters.js';
import { initActivityFilters, clearActivityFilters, applyActivityFilter, captureMedicalFilters } from './ui_medical_filters.js';
import { openComparison, closeComparison } from './ui_comparison.js';
import { loadEstablishment } from './ui_details.js';

/**
 * Updates global statistics on the dashboard
 */
export function updateGlobalStats() {
    let sites;
    if (state.table) {
        const filteredData = state.table.rows({ filter: 'applied' }).data().toArray();
        const filteredFiness = filteredData.map(r => r[1]); // FINESS is in column 1
        sites = filteredFiness.map(f => state.mapping[f]).filter(Boolean);
    } else {
        sites = Object.values(state.mapping);
    }

    const totalSites = sites.length;
    const regions = new Set(sites.map(s => s.reg_name).filter(Boolean));
    const departments = new Set(sites.map(s => s.dep_code).filter(Boolean));

    let publicCount = 0;
    let priveCount = 0;

    sites.forEach(s => {
        const cat = s.categorie || '';
        const catUpper = cat.toUpperCase();
        if (catUpper.includes('PRIVÉ') || catUpper.includes('PRIVE') || cat === 'OQN') {
            priveCount++;
        } else if (cat) {
            publicCount++;
        }
    });

    document.getElementById('stat-total-sites').textContent = totalSites.toLocaleString();
    document.getElementById('stat-total-regions').textContent = regions.size;
    document.getElementById('stat-regions-meta').textContent = "Départements : " + departments.size;

    document.getElementById('stat-ch-count').textContent = publicCount;
    document.getElementById('stat-ch-percent').textContent = totalSites > 0 ? ((publicCount / totalSites) * 100).toFixed(2) + "% du total" : "0%";

    document.getElementById('stat-prive-count').textContent = priveCount;
    document.getElementById('stat-prive-percent').textContent = totalSites > 0 ? ((priveCount / totalSites) * 100).toFixed(2) + "% du total" : "0%";
}

/**
 * Closes all open drawers/drawers
 */
export function closeDetails() {
    document.getElementById('detail-view').style.display = 'none';
    closeComparison();
}

/**
 * wires everything to the window object for global access from HTML
 */
export function wireGlobals() {
    window.applyFilters = applyFilters;
    window.updateDeptFilter = updateDeptFilter;
    window.openComparison = openComparison;
    window.closeComparison = closeComparison;
    window.closeDetails = closeDetails;
    window.loadEstablishment = loadEstablishment;
    window.clearActivityFilters = clearActivityFilters;
    window.applyActivityFilter = applyActivityFilter;

    // Keydown for Escape
    document.addEventListener('keydown', (event) => {
        if (event.key === "Escape" || event.key === "Esc") {
            closeDetails();
        }
    });
}

// Initializations that don't depend on data loading can go here
export function initUI() {
    populateFilters();
    wireGlobals();
}

// js/ui.js
import { state, config } from './state.js';
import { fetchHistory, fetchMapActivityData } from './api.js';
import { refreshViews } from './map.js';

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
        minimumResultsForSearch: 10 // Only show search if many options
    });
}

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

    if (document.getElementById('comparison-view').style.display === 'block' && lastComparisonData) {
        renderComparison(lastComparisonData);
    }
}

// --- Multi-Establishment Comparison ---

window.closeComparison = function () {
    document.getElementById('comparison-view').style.display = 'none';
};

export async function openComparison() {
    const selected = state.selectedFiness;
    if (selected.length < 2) return;

    document.getElementById('comparison-view').style.display = 'block';
    const content = document.getElementById('comparison-indicators');
    content.innerHTML = '<div style="color: var(--text-muted); padding: 2rem;">Chargement des données comparatives...</div>';

    try {
        // Parallel load of all selected establishments
        const dataPromises = selected.map(async (finess) => {
            const historyFiles = await fetchHistory(finess);
            const filePromises = historyFiles.map(file => fetch(config.cdnPrefix + file).then(r => r.json()));
            const allFilesData = await Promise.all(filePromises);

            // Merge periods for this specific finess
            let merged = { finess, raison_sociale: state.mapping[finess].reason_sociale || state.mapping[finess].raison_sociale, periodes: {} };
            allFilesData.forEach(fileData => {
                if (fileData.periodes) {
                    Object.entries(fileData.periodes).forEach(([p, data]) => {
                        merged.periodes[p] = data;
                    });
                }
            });
            return merged;
        });

        const allEstablishmentsData = await Promise.all(dataPromises);
        lastComparisonData = allEstablishmentsData;
        renderComparison(allEstablishmentsData);

    } catch (err) {
        console.error("Comparison Error:", err);
        content.innerHTML = `<div style="color: #f87171; padding: 2rem;">Erreur: ${err.message}</div>`;
    }
}

function renderComparison(allData) {
    const filters = window.currentMedicalFilters || { selCms: [], selGns: [], selGmes: [], hasFilter: false };
    const isFiltered = filters?.hasFilter === true;

    // 1. Determine all unique periods across all establishments
    const allLabels = [...new Set(allData.flatMap(d => Object.keys(d.periodes)))].sort();

    // 2. Prepare datasets for activity chart
    const chartDatasets = allData.map((d, idx) => {
        const colors = ['#a78bfa', '#34d399', '#f59e0b', '#38bdf8', '#f43f5e', '#fbbf24'];
        const color = colors[idx % colors.length];

        return {
            label: d.raison_sociale,
            data: allLabels.map(p => {
                let total = 0;
                const pData = d.periodes[p] || {};
                Object.entries(pData).forEach(([catMaj, gns]) => {
                    if (catMaj === 'total') return;
                    if (filters.selCms.length > 0 && !filters.selCms.includes(catMaj)) return;
                    Object.entries(gns || {}).forEach(([gnId, gmes]) => {
                        if (filters.selGns.length > 0 && !filters.selGns.includes(gnId)) return;
                        Object.entries(gmes || {}).forEach(([gmeId, code]) => {
                            if (filters.selGmes.length > 0 && !filters.selGmes.includes(gmeId)) return;
                            const days = (parseInt(code.nb_journees_hc) || 0) + (parseInt(code.nb_journees_hp) || 0);
                            if (!isNaN(days)) total += days;
                        });
                    });
                });
                return total > 0 ? total : null;
            }),
            borderColor: color,
            backgroundColor: 'transparent',
            borderWidth: 2,
            pointRadius: 3,
            tension: 0.3,
            spanGaps: true
        };
    });

    // 3. Render Activity Comparison Chart
    document.getElementById('comparison-name').textContent = isFiltered ? `📉 Comparaison d'Établissements (Filtré)` : `Comparaison d'Établissements`;
    const ctx = document.getElementById('comparisonChart').getContext('2d');
    if (comparisonChartInstance) comparisonChartInstance.destroy();
    comparisonChartInstance = new Chart(ctx, {
        type: 'line',
        data: { labels: allLabels, datasets: chartDatasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 10 } } } },
            scales: {
                y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
                x: { grid: { display: false }, ticks: { color: '#94a3b8' } }
            }
        }
    });

    // 4. Render Indicator Comparison (Latest Period)
    const indicatorsContent = document.getElementById('comparison-indicators');
    let html = `
        <div style="grid-column: 1 / -1; display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem; margin-bottom: 2rem;">
    `;

    allData.forEach(d => {
        const lastP = Object.keys(d.periodes).sort().pop();
        const pData = d.periodes[lastP] || {};

        let wSumAge = 0, wDaysAge = 0;
        let wSumSexe = 0, wDaysSexe = 0;
        let totalDays = 0;

        Object.entries(pData).forEach(([catMaj, gns]) => {
            if (catMaj === 'total') return;
            if (filters.selCms.length > 0 && !filters.selCms.includes(catMaj)) return;
            Object.entries(gns || {}).forEach(([gnId, gmes]) => {
                if (filters.selGns.length > 0 && !filters.selGns.includes(gnId)) return;
                Object.entries(gmes || {}).forEach(([gmeId, code]) => {
                    if (filters.selGmes.length > 0 && !filters.selGmes.includes(gmeId)) return;
                    const days = (parseInt(code.nb_journees_hc) || 0) + (parseInt(code.nb_journees_hp) || 0);
                    if (days > 0) {
                        totalDays += days;
                        const age = parseFloat(code.age_moyen);
                        if (!isNaN(age)) { wSumAge += age * days; wDaysAge += days; }
                        const sexe = parseFloat(code.sexe_ratio);
                        if (!isNaN(sexe)) { wSumSexe += sexe * days; wDaysSexe += days; }
                    }
                });
            });
        });

        const avgAge = wDaysAge > 0 ? (wSumAge / wDaysAge).toFixed(1) : "N/A";
        const avgSexe = wDaysSexe > 0 ? (wSumSexe / wDaysSexe).toFixed(1) : "N/A";

        html += `
            <div class="stat-card" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1);">
                <div style="font-weight: 600; font-size: 0.9rem; margin-bottom: 0.8rem; color: var(--primary-light); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${d.raison_sociale}">
                    ${d.raison_sociale}
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.4rem;">
                    <span style="font-size: 0.8rem; color: var(--text-muted);">Âge Moyen</span>
                    <span style="font-weight: 600;">${avgAge} ans</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.4rem;">
                    <span style="font-size: 0.8rem; color: var(--text-muted);">Sexe Ratio</span>
                    <span style="font-weight: 600;">${avgSexe}% H</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-top: 0.8rem; padding-top: 0.8rem; border-top: 1px solid rgba(255,255,255,0.05);">
                    <span style="font-size: 0.8rem; color: var(--text-muted);">Activité</span>
                    <span style="font-weight: 600; color: var(--primary-light);">${totalDays.toLocaleString()} j.</span>
                </div>
            </div>
        `;
    });

    html += `</div>`;
    indicatorsContent.innerHTML = html;
}

export function updateGlobalStats() {
    let sites;
    if (state.table) {
        // Get rows that match the current filter correctly
        const filteredData = state.table.rows({ filter: 'applied' }).data().toArray();
        const filteredFiness = filteredData.map(r => r[1]); // FINESS is in the second column (index 1)
        sites = filteredFiness.map(f => state.mapping[f]).filter(Boolean); // filter Boolean just in case
    } else {
        sites = Object.values(state.mapping);
    }

    const totalSites = sites.length;
    const regions = new Set(sites.map(s => s.reg_name).filter(Boolean));
    const departments = new Set(sites.map(s => s.dep_code).filter(Boolean));

    // Categorization logic:
    // Public/PSPH: CH, CHR/U, PSPH/EBNL, AP-HP, CLCC, etc.
    // Privé: Privé, Privé commercial, etc.
    let publicCount = 0;
    let priveCount = 0;

    sites.forEach(s => {
        const cat = s.categorie || '';
        const catUpper = cat.toUpperCase();

        // Count as private if explicitly marked 'Privé', otherwise default to public for hospital types
        if (catUpper.includes('PRIVÉ') || catUpper.includes('PRIVE') || cat === 'OQN') {
            priveCount++;
        } else if (cat) { // If it has a category and is not private, it's public/non-profit
            publicCount++;
        }
    });

    // Mise à jour DOM
    document.getElementById('stat-total-sites').textContent = totalSites.toLocaleString();
    document.getElementById('stat-total-regions').textContent = regions.size;
    document.getElementById('stat-regions-meta').textContent = "Départements : " + departments.size;

    document.getElementById('stat-ch-count').textContent = publicCount;
    document.getElementById('stat-ch-percent').textContent = totalSites > 0 ? ((publicCount / totalSites) * 100).toFixed(1) + "% du total" : "0%";

    document.getElementById('stat-prive-count').textContent = priveCount;
    document.getElementById('stat-prive-percent').textContent = totalSites > 0 ? ((priveCount / totalSites) * 100).toFixed(1) + "% du total" : "0%";
}

export async function loadEstablishment(finess) {

    // Reset & Show Drawer
    document.getElementById('detail-view').style.display = 'block';
    document.getElementById('det-name').textContent = state.mapping[finess].raison_sociale;
    document.getElementById('det-metrics').innerHTML = '<div style="color: var(--text-muted)">Chargement de l\'historique...</div>';
    document.getElementById('det-raw').textContent = "Accès aux fichiers JSON de l'établissement...";

    try {
        let historyFiles = [];

        historyFiles = await fetchHistory(finess);

        if (historyFiles.length === 0) {
            throw new Error("Aucune donnée trouvée pour cet établissement.");
        }

        // 2. Charger tous les fichiers en parallèle
        const dataPromises = historyFiles.map(file => {
            let url = config.cdnPrefix + file;
            return fetch(url).then(r => {
                if (!r.ok) {
                    throw new Error(`Fichier introuvable ou erreur réseau (${r.status}) pour : ${url}`);
                }
                return r.json();
            });
        });

        const allHistoricalData = await Promise.all(dataPromises);

        // 3. Fusionner les données (par ordre chronologique pour que le plus récent écrase l'ancien)
        // Les fichiers sont déjà triés par nom (date) par fetchHistory
        let mergedData = {
            finess: finess,
            raison_sociale: state.mapping[finess].raison_sociale,
            geo: state.mapping[finess],
            site_updated_at: allHistoricalData[allHistoricalData.length - 1].site_updated_at,
            periodes: {},
            sources: historyFiles.map(f => f.name)
        };

        allHistoricalData.forEach(fileData => {
            if (fileData.periodes) {
                Object.keys(fileData.periodes).forEach(periode => {
                    // Overwrite logic: le fichier lu plus tard (plus récent par nom) remplace la période
                    mergedData.periodes[periode] = fileData.periodes[periode];
                });
            }
        });

        renderDetails(mergedData);

    } catch (err) {
        console.error("Erreur lors du chargement de l'établissement :", err);
        document.getElementById('det-raw').innerHTML = `<span style="color: #ef4444">⚠️ ${err.message}</span>`;

        // CORRECTION : On utilise mainChartInstance
        if (mainChartInstance) mainChartInstance.destroy();

        document.getElementById('det-metrics').innerHTML = "";
        document.getElementById('det-smr-metrics').innerHTML = "";
        document.getElementById('det-meta-top').innerHTML = "";
    }
}

function closeDetails() {
    document.getElementById('detail-view').style.display = 'none';
    document.getElementById('comparison-view').style.display = 'none';
}

window.closeDetails = closeDetails;

document.addEventListener('keydown', function (event) {
    if (event.key === "Escape" || event.key === "Esc") {
        closeDetails();
    }
});

// Variables pour stocker les instances des graphiques afin de pouvoir les détruire avant de les redessiner
let mainChartInstance = null;
let profilingChartInstance = null;
let indicatorTrendChartInstance = null;
let comparisonChartInstance = null;
let lastComparisonData = null; // To allow re-render on filter change

// 1. Fonction qui gère les cases à cocher de l'arbre (Catégories > GN > GME)
window.handleProfileToggle = function (cb) {
    const isChecked = cb.checked;

    // Propagate downwards (check all children)
    if (cb.classList.contains('cm-cb') || cb.classList.contains('gn-cb')) {
        const container = cb.closest('details');
        if (container) {
            const descendants = container.querySelectorAll('.profile-cb');
            descendants.forEach(d => {
                d.checked = isChecked;
                d.indeterminate = false; // reset indeterminate
            });
        }
    }

    // Propagate upwards (sync parents)
    let currentItem = cb.closest('.gme-item') || cb.closest('details');
    while (currentItem) {
        let parentDetails = currentItem.parentElement.closest('details');
        if (!parentDetails) break;

        let parentCb = parentDetails.querySelector(':scope > summary .profile-cb');
        if (!parentCb) break;

        let childrenContainer = parentDetails.querySelector(':scope > div');
        if (!childrenContainer) break;

        let childCbs = Array.from(childrenContainer.children).map(el => {
            if (el.classList.contains('gme-item') || el.classList.contains('gn-item')) {
                return el.querySelector('.profile-cb');
            }
            if (el.tagName === 'DETAILS') {
                return el.querySelector(':scope > summary .profile-cb');
            }
            return null;
        }).filter(Boolean);

        const allChecked = childCbs.length > 0 && childCbs.every(c => c.checked);
        const someChecked = childCbs.some(c => c.checked || c.indeterminate);

        parentCb.checked = allChecked;
        parentCb.indeterminate = (!allChecked && someChecked);

        currentItem = parentDetails;
    }

    // Mise à jour du graphique des écarts
    window.updateProfileChart();
};

// 2. Fonction qui dessine le graphique "Profil de l'Activité Sélectionnée" (Barres d'écarts)
window.updateProfileChart = function () {
    const checkedGMEs = document.querySelectorAll('.gme-cb:checked');
    const container = document.getElementById('profiling-section');

    if (checkedGMEs.length === 0) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';

    let sumDays = 0;
    let wAge = 0, dAge = 0;
    let wSexe = 0, dSexe = 0;
    let wAvqp = 0, dAvqp = 0;
    let wAvqr = 0, dAvqr = 0;
    let wCsarr = 0, dCsarr = 0;

    checkedGMEs.forEach(cb => {
        const days = parseInt(cb.dataset.days) || 0;
        sumDays += days;

        const age = parseFloat(cb.dataset.age);
        if (!isNaN(age)) { wAge += age * days; dAge += days; }

        const sexe = parseFloat(cb.dataset.sexe);
        if (!isNaN(sexe)) { wSexe += sexe * days; dSexe += days; }

        const avqp = parseFloat(cb.dataset.avqp);
        if (!isNaN(avqp)) { wAvqp += avqp * days; dAvqp += days; }

        const avqr = parseFloat(cb.dataset.avqr);
        if (!isNaN(avqr)) { wAvqr += avqr * days; dAvqr += days; }

        const csarr = parseFloat(cb.dataset.csarr);
        if (!isNaN(csarr)) { wCsarr += csarr * days; dCsarr += days; }
    });

    const sAge = dAge > 0 ? (wAge / dAge).toFixed(1) : 0;
    const sSexe = dSexe > 0 ? (wSexe / dSexe).toFixed(1) : 0;
    const sAvqp = dAvqp > 0 ? (wAvqp / dAvqp).toFixed(2) : 0;
    const sAvqr = dAvqr > 0 ? (wAvqr / dAvqr).toFixed(2) : 0;
    const sCsarr = dCsarr > 0 ? (wCsarr / dCsarr).toFixed(2) : 0;

    // Récupération des métriques globales stockées lors du chargement de l'établissement
    const glob = window.globalMetrics || {};
    const gAge = parseFloat(glob.avgAge) || 0;
    const gSexe = parseFloat(glob.avgSexe) || 0;
    const gAvqp = parseFloat(glob.avgAVQP) || 0;
    const gAvqr = parseFloat(glob.avgAVQR) || 0;
    const gCsarr = parseFloat(glob.avgCSARR) || 0;

    const diffAge = gAge > 0 && sAge > 0 ? ((sAge - gAge) / gAge) * 100 : 0;
    const diffSexe = gSexe > 0 && sSexe > 0 ? ((sSexe - gSexe) / gSexe) * 100 : 0;
    const diffAvqp = gAvqp > 0 && sAvqp > 0 ? ((sAvqp - gAvqp) / gAvqp) * 100 : 0;
    const diffAvqr = gAvqr > 0 && sAvqr > 0 ? ((sAvqr - gAvqr) / gAvqr) * 100 : 0;
    const diffCsarr = gCsarr > 0 && sCsarr > 0 ? ((sCsarr - gCsarr) / gCsarr) * 100 : 0;

    const ctx = document.getElementById('profilingChart').getContext('2d');
    if (profilingChartInstance) profilingChartInstance.destroy();

    profilingChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Âge Moyen', 'Sexe Ratio (%H)', 'AVQ Physique', 'AVQ Relationnel', 'Actes CSARR'],
            datasets: [{
                label: 'Écart % vs Moyen',
                data: [diffAge, diffSexe, diffAvqp, diffAvqr, diffCsarr],
                backgroundColor: [diffAge, diffSexe, diffAvqp, diffAvqr, diffCsarr].map(v => v >= 0 ? 'rgba(74, 222, 128, 0.5)' : 'rgba(248, 113, 113, 0.5)'),
                borderColor: [diffAge, diffSexe, diffAvqp, diffAvqr, diffCsarr].map(v => v >= 0 ? 'rgb(74, 222, 128)' : 'rgb(248, 113, 113)'),
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const val = context.raw.toFixed(1) + '%';
                            const idx = context.dataIndex;
                            const sel = [sAge, sSexe, sAvqp, sAvqr, sCsarr][idx];
                            const globV = [gAge, gSexe, gAvqp, gAvqr, gCsarr][idx];
                            return `${val} (Sélection: ${sel} vs Global: ${globV})`;
                        }
                    }
                },
                legend: { display: false }
            }
        }
    });
};

// 3. Fonction qui affiche l'évolution temporelle d'un indicateur précis
window.showIndicatorTrend = function (field, label, unit) {
    const pd = window.allPeriodes;
    if (!pd) return;

    const section = document.getElementById('indicator-trend-section');
    const titleEl = document.getElementById('indicator-trend-title');
    titleEl.textContent = `Évolution de l'indicateur ${label} (${unit})`;
    section.style.display = 'block';

    const filters = window.currentMedicalFilters || { selCms: [], selGns: [], selGmes: [], hasFilter: false };

    const seriesData = pd.labels.map(p => {
        let wSum = 0, wDays = 0;
        const periodData = pd.rawData[p] || {};

        Object.entries(periodData).forEach(([catMaj, gns]) => {
            if (catMaj === 'total') return;
            if (filters.selCms.length > 0 && !filters.selCms.includes(catMaj)) return;

            Object.entries(gns || {}).forEach(([gnId, gmes]) => {
                if (filters.selGns.length > 0 && !filters.selGns.includes(gnId)) return;

                Object.entries(gmes || {}).forEach(([gmeId, code]) => {
                    if (filters.selGmes.length > 0 && !filters.selGmes.includes(gmeId)) return;

                    const val = parseFloat(code[field]);
                    const hc = parseInt(code.nb_journees_hc) || 0;
                    const hp = parseInt(code.nb_journees_hp) || 0;
                    const days = hc + hp;

                    if (!isNaN(val) && days > 0) {
                        wSum += val * days;
                        wDays += days;
                    }
                });
            });
        });

        return wDays > 0 ? parseFloat((wSum / wDays).toFixed(2)) : null;
    });

    const ctx = document.getElementById('indicatorTrendChart').getContext('2d');
    if (indicatorTrendChartInstance) indicatorTrendChartInstance.destroy();

    indicatorTrendChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: pd.labels,
            datasets: [{
                label: `${label} (${unit})`,
                data: seriesData,
                borderColor: '#38bdf8',
                backgroundColor: 'rgba(56, 189, 248, 0.1)',
                borderWidth: 2,
                pointRadius: 4,
                pointHoverRadius: 6,
                fill: true,
                tension: 0.3,
                spanGaps: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: ctx => `${label}: ${ctx.raw} ${unit}`
                    }
                }
            },
            scales: {
                y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', font: { size: 10 } } },
                x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 } } }
            }
        }
    });

    // Défilement automatique vers le graphique
    section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

function updateDeptFilter() {
    const selectedRegion = document.getElementById('filter-region').value;
    const sites = Object.values(state.mapping);
    const deptSelect = document.getElementById('filter-dept');

    // Clear existing options except the first one
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

export function captureMedicalFilters() {
    const selCms = ($('#filter-cm').val() || []).filter(v => v && v !== 'ALL');
    const selGns = ($('#filter-gn').val() || []).filter(Boolean);
    const selGmes = ($('#filter-gme').val() || []).filter(Boolean);
    const hasFilter = selCms.length > 0 || selGns.length > 0 || selGmes.length > 0;

    window.currentMedicalFilters = { selCms, selGns, selGmes, hasFilter };
    return window.currentMedicalFilters;
}

export function renderDetails(data) {
    const periodes = Object.keys(data.periodes || {}).sort();

    const filters = captureMedicalFilters();

    // Reset optional panels when switching establishments
    document.getElementById('indicator-trend-section').style.display = 'none';
    document.getElementById('profiling-section').style.display = 'none';
    document.querySelectorAll('.profile-cb').forEach(cb => { cb.checked = false; cb.indeterminate = false; });

    document.getElementById('det-meta-top').innerHTML = `
    <div style="display:flex; gap:0.5rem; flex-wrap: wrap;">
        <span class="badge">FINESS ${data.finess}</span>
        <span class="badge" style="color:var(--primary-light)">${data.geo?.categorie || 'N/A'}</span>
        <span class="badge" style="color:var(--text-muted)">MàJ ${data.site_updated_at || 'Jan 2026'}</span>
        <span class="badge" style="background: rgba(139, 92, 246, 0.1); color: #a78bfa; border: 1px solid rgba(139, 92, 246, 0.2);">Historique : ${data.sources?.length || 0} fichiers</span>
    </div>
`;
    const baseTitle = data.raison_sociale || "Établissement inconnu";
    const isFiltered = filters?.hasFilter === true;
    document.getElementById('det-name').textContent = isFiltered ? `📉 ${baseTitle} (Filtré)` : baseTitle;

    if (periodes.length > 0) {
        const labels = periodes;

        // Compute per-period totals: total, HC, HP
        const sumForPeriod = (p, field) => {
            let total = 0;
            Object.entries(data.periodes[p] || {}).forEach(([catMaj, gns]) => {
                if (catMaj === 'total') return;
                if (filters.selCms.length > 0 && !filters.selCms.includes(catMaj)) return;
                Object.entries(gns || {}).forEach(([gnId, gmes]) => {
                    if (filters.selGns.length > 0 && !filters.selGns.includes(gnId)) return;
                    Object.entries(gmes || {}).forEach(([gmeId, code]) => {
                        if (filters.selGmes.length > 0 && !filters.selGmes.includes(gmeId)) return;
                        const val = parseInt(code[field]);
                        if (!isNaN(val)) total += val;
                    });
                });
            });
            return total;
        };

        const values = labels.map(p => sumForPeriod(p, 'nb_journees_hc') + sumForPeriod(p, 'nb_journees_hp'));
        const hcValues = labels.map(p => sumForPeriod(p, 'nb_journees_hc'));
        const hpValues = labels.map(p => sumForPeriod(p, 'nb_journees_hp'));

        // Store globally for indicator trend usage
        window.allPeriodes = { labels, rawData: data.periodes };

        updateChart(labels, values, hcValues, hpValues);

        // Calcul metrics dernière période
        const lastP = periodes[periodes.length - 1];
        let hc = 0, hp = 0;

        // Breakdown by CatMaj > GN > GME
        const catMajBreakdown = {};
        const fullBreakdown = {};

        let totalDaysForAge = 0, weightedSumAge = 0;
        let totalDaysForSexe = 0, weightedSumSexe = 0;
        let totalDaysForAVQP = 0, weightedSumAVQP = 0;
        let totalDaysForAVQR = 0, weightedSumAVQR = 0;
        let totalStaysForCSARR = 0, weightedSumCSARR = 0; // CSARR is usually per stay

        Object.entries(data.periodes[lastP] || {}).forEach(([catMaj, gns]) => {
            if (catMaj === 'total') return; // Do not treat the official totals as a medical category
            if (filters.selCms.length > 0 && !filters.selCms.includes(catMaj)) return;

            let catTotal = 0;
            fullBreakdown[catMaj] = { total: 0, gns: {}, wAge: 0, dAge: 0, wSexe: 0, dSexe: 0, wAvqp: 0, dAvqp: 0, wAvqr: 0, dAvqr: 0, wCsarr: 0, sCsarr: 0 };

            Object.entries(gns || {}).forEach(([gnId, gmes]) => {
                if (filters.selGns.length > 0 && !filters.selGns.includes(gnId)) return;
                let gnTotal = 0;
                fullBreakdown[catMaj].gns[gnId] = { total: 0, gmes: {}, wAge: 0, dAge: 0, wSexe: 0, dSexe: 0, wAvqp: 0, dAvqp: 0, wAvqr: 0, dAvqr: 0, wCsarr: 0, sCsarr: 0 };

                Object.entries(gmes || {}).forEach(([gmeId, code]) => {
                    if (filters.selGmes.length > 0 && !filters.selGmes.includes(gmeId)) return;
                    const c_hc = parseInt(code.nb_journees_hc) || 0;
                    const c_hp = parseInt(code.nb_journees_hp) || 0;
                    const days = c_hc + c_hp;

                    if (days > 0) {
                        hc += c_hc;
                        hp += c_hp;
                        catTotal += days;
                        gnTotal += days;
                        fullBreakdown[catMaj].gns[gnId].total += days;
                        fullBreakdown[catMaj].total += days;
                        fullBreakdown[catMaj].gns[gnId].gmes[gmeId] = { total: days, code: code, hc: c_hc, hp: c_hp };

                        const age = parseFloat(code.age_moyen);
                        if (!isNaN(age)) {
                            weightedSumAge += age * days;
                            totalDaysForAge += days;
                            fullBreakdown[catMaj].wAge += age * days;
                            fullBreakdown[catMaj].dAge += days;
                            fullBreakdown[catMaj].gns[gnId].wAge += age * days;
                            fullBreakdown[catMaj].gns[gnId].dAge += days;
                        }

                        const sexe = parseFloat(code.sexe_ratio);
                        if (!isNaN(sexe)) {
                            weightedSumSexe += sexe * days;
                            totalDaysForSexe += days;
                            fullBreakdown[catMaj].wSexe += sexe * days;
                            fullBreakdown[catMaj].dSexe += days;
                            fullBreakdown[catMaj].gns[gnId].wSexe += sexe * days;
                            fullBreakdown[catMaj].gns[gnId].dSexe += days;
                        }

                        const avqp = parseFloat(code.avq_physique);
                        if (!isNaN(avqp)) {
                            weightedSumAVQP += avqp * days;
                            totalDaysForAVQP += days;
                            fullBreakdown[catMaj].wAvqp += avqp * days;
                            fullBreakdown[catMaj].dAvqp += days;
                            fullBreakdown[catMaj].gns[gnId].wAvqp += avqp * days;
                            fullBreakdown[catMaj].gns[gnId].dAvqp += days;
                        }

                        const avqr = parseFloat(code.avq_relationnel);
                        if (!isNaN(avqr)) {
                            weightedSumAVQR += avqr * days;
                            totalDaysForAVQR += days;
                            fullBreakdown[catMaj].wAvqr += avqr * days;
                            fullBreakdown[catMaj].dAvqr += days;
                            fullBreakdown[catMaj].gns[gnId].wAvqr += avqr * days;
                            fullBreakdown[catMaj].gns[gnId].dAvqr += days;
                        }

                        const csarr = parseFloat(code.nb_actes_csarr);
                        if (!isNaN(csarr)) {
                            weightedSumCSARR += csarr * days;
                            totalStaysForCSARR += days;
                            fullBreakdown[catMaj].wCsarr += csarr * days;
                            fullBreakdown[catMaj].sCsarr += days;
                            fullBreakdown[catMaj].gns[gnId].wCsarr += csarr * days;
                            fullBreakdown[catMaj].gns[gnId].sCsarr += days;
                        }
                    }
                });
                if (gnTotal === 0) delete fullBreakdown[catMaj].gns[gnId];
            });
            if (catTotal > 0) {
                catMajBreakdown[catMaj] = catTotal;
            } else {
                delete fullBreakdown[catMaj];
            }
        });

        const avgAge = totalDaysForAge > 0 ? (weightedSumAge / totalDaysForAge).toFixed(1) : "N/A";
        const avgSexe = totalDaysForSexe > 0 ? (weightedSumSexe / totalDaysForSexe).toFixed(1) : "N/A";
        const avgAVQP = totalDaysForAVQP > 0 ? (weightedSumAVQP / totalDaysForAVQP).toFixed(2) : "N/A";
        const avgAVQR = totalDaysForAVQR > 0 ? (weightedSumAVQR / totalDaysForAVQR).toFixed(2) : "N/A";
        const avgCSARR = totalStaysForCSARR > 0 ? (weightedSumCSARR / totalStaysForCSARR).toFixed(2) : "N/A";

        window.globalMetrics = { avgAge, avgSexe, avgAVQP, avgAVQR, avgCSARR };

        const official = (data.periodes[lastP] || {}).total || {};

        const secrecyInfo = `<span title="Les différences mineures s'expliquent par le secret statistique (valeurs '1 à 10' masquées dans le détail mais incluses dans le total officiel) et le calcul de moyennes pondérées." style="cursor:help; font-size: 0.8em; vertical-align: middle;">ℹ️</span>`;

        const compare = (calc, off, unit = "") => {
            const unitHtml = unit ? ` ${unit.trim()}` : '';
            // If the view is filtered, we don't compare with official global totals
            if (filters.hasFilter || !off) return { text: `${calc}${unitHtml}`, match: true };

            const c = parseFloat(calc.toString().replace(/\s/g, ''));
            const o = parseFloat(off.toString().replace(/\s/g, ''));
            const diff = Math.abs(c - o);
            if (diff === 0) return { text: `${calc}${unitHtml}`, match: true }; // Perfect match, no Off info

            const threshold = o * 0.05; // 5% de tolérance
            const warn = diff > threshold ? '⚠️' : '';
            return { text: `${calc}${unitHtml} ${warn} <span style="font-size:0.8em; color:#666">(Off: ${off})</span>`, match: false };
        };

        const totalRes = compare((hc + hp).toLocaleString(), official.nb_journees_total ? parseInt(official.nb_journees_total).toLocaleString() : null, " j.");
        const hcRes = compare(hc.toLocaleString(), official.nb_journees_hc ? parseInt(official.nb_journees_hc).toLocaleString() : null, " j.");
        const hpRes = compare(hp.toLocaleString(), official.nb_journees_hp ? parseInt(official.nb_journees_hp).toLocaleString() : null, " j.");

        document.getElementById('det-metrics').innerHTML = `
        <div class="metric-card" style="grid-column: 1 / -1;">
            <div class="metric-label">Total des Journées ${!totalRes.match ? secrecyInfo : ''}</div>
            <div class="metric-value">${totalRes.text}</div>
        </div>
        <div class="metric-card">
            <div class="metric-label">Hospitalisation Complète ${!hcRes.match ? secrecyInfo : ''}</div>
            <div class="metric-value">${hcRes.text}</div>
        </div>
        <div class="metric-card">
            <div class="metric-label">Hospitalisation Partielle ${!hpRes.match ? secrecyInfo : ''}</div>
            <div class="metric-value">${hpRes.text}</div>
        </div>
        `;

        // Mise à jour des titres de section pour inclure la période et la date
        const sectionTitles = document.querySelectorAll('#detail-content .section-title');
        sectionTitles.forEach(el => {
            if (el.textContent.includes("Dernière Période Connue") || el.textContent.includes("Période ")) {
                el.textContent = `Période ¹${lastP}`.replace('¹', '');
            }
        });

        document.getElementById('det-smr-metrics').innerHTML = `
        <div class="metric-card" style="cursor: pointer;" onclick="window.showIndicatorTrend('age_moyen', 'Âge Moyen', 'ans')">
            <div class="metric-label">Âge Moyen <span style="font-size:0.7em; color: var(--text-muted);">(évolution ▶)</span></div>
            <div class="metric-value">${compare(avgAge, official.age_moyen, " ans").text}</div>
        </div>
        <div class="metric-card" style="cursor: pointer;" onclick="window.showIndicatorTrend('sexe_ratio', 'Sexe Ratio', '%H')">
            <div class="metric-label">Sexe Ratio <span style="font-size:0.7em; color: var(--text-muted);">(évolution ▶)</span></div>
            <div class="metric-value">${compare(avgSexe, official.sexe_ratio, "% H").text}</div>
        </div>
        <div class="metric-card" style="cursor: pointer;" onclick="window.showIndicatorTrend('avq_physique', 'AVQ Physique', '/4')">
            <div class="metric-label">AVQ Physique <span style="font-size:0.7em; color: var(--text-muted);">(évolution ▶)</span></div>
            <div class="metric-value">${compare(avgAVQP, official.avq_physique, " /4").text}</div>
        </div>
        <div class="metric-card" style="cursor: pointer;" onclick="window.showIndicatorTrend('avq_relationnel', 'AVQ Relationnel', '/4')">
            <div class="metric-label">AVQ Relationnel <span style="font-size:0.7em; color: var(--text-muted);">(évolution ▶)</span></div>
            <div class="metric-value">${compare(avgAVQR, official.avq_relationnel, " /4").text}</div>
        </div>
        <div class="metric-card" style="cursor: pointer;" onclick="window.showIndicatorTrend('nb_actes_csarr', 'Actes CSARR', '/j.')">
            <div class="metric-label">Actes CSARR <span style="font-size:0.7em; color: var(--text-muted);">(évolution ▶)</span></div>
            <div class="metric-value">${compare(avgCSARR, official.nb_actes_csarr, " /j.").text}</div>
        </div>
        `;

        // Generic stat tooltip generator
        const buildInfoTooltip = (title, age, sexe, avqp, avqr, csarr) => {
            let parts = [];
            if (age && age !== "N/A" && !isNaN(parseFloat(age))) parts.push(`Âge moyen: ${parseFloat(age).toFixed(1)} ans (Moyenne: ${avgAge})`);
            if (sexe && sexe !== "N/A" && !isNaN(parseFloat(sexe))) parts.push(`Sexe Ratio: ${parseFloat(sexe).toFixed(1)}% H (Moyenne: ${avgSexe})`);
            if (avqp && avqp !== "N/A" && !isNaN(parseFloat(avqp))) parts.push(`AVQ Physique: ${parseFloat(avqp).toFixed(2)} /4 (Moyenne: ${avgAVQP})`);
            if (avqr && avqr !== "N/A" && !isNaN(parseFloat(avqr))) parts.push(`AVQ Relationnel: ${parseFloat(avqr).toFixed(2)} /4 (Moyenne: ${avgAVQR})`);
            if (csarr && csarr !== "N/A" && !isNaN(parseFloat(csarr))) parts.push(`Actes CSARR: ${parseFloat(csarr).toFixed(2)} /j. (Moyenne: ${avgCSARR})`);
            if (parts.length === 0) return '';
            return `<span title="Indicateurs de profil pour '${title.replace(/"/g, '&quot;')}':&#10;${parts.join('&#10;')}" style="cursor:help; font-size: 0.9em; vertical-align: middle; filter: grayscale(1); opacity: 0.6; margin-left: 0.3rem;">ℹ️</span>`;
        };



        // Render Activity Breakdown Hierarchical
        let breakdownHtml = '<div style="margin-top: 1rem; background: rgba(255,255,255,0.03); border-radius: 12px; padding: 1rem; border: 1px solid rgba(255,255,255,0.05);">';
        // breakdownHtml += '<h4 style="margin: 0 0 1rem 0; font-size: 0.9rem; color: var(--primary-light);">Détail de l\'Activité (CM > GN > GME)</h4>';

        const sortedCMs = Object.entries(fullBreakdown).sort((a, b) => b[1].total - a[1].total);

        if (sortedCMs.length > 0) {
            sortedCMs.forEach(([cmId, cmData]) => {
                const cmLabel = state.catMajLabels[cmId] || cmId;

                const cAge = cmData.dAge > 0 ? cmData.wAge / cmData.dAge : null;
                const cSexe = cmData.dSexe > 0 ? cmData.wSexe / cmData.dSexe : null;
                const cAvqp = cmData.dAvqp > 0 ? cmData.wAvqp / cmData.dAvqp : null;
                const cAvqr = cmData.dAvqr > 0 ? cmData.wAvqr / cmData.dAvqr : null;
                const cCsarr = cmData.sCsarr > 0 ? cmData.wCsarr / cmData.sCsarr : null;
                const infoHtml = buildInfoTooltip(cmLabel, cAge, cSexe, cAvqp, cAvqr, cCsarr);

                // Only open the first one by default if there are few
                const isOpen = sortedCMs.length <= 2 ? 'open' : '';
                breakdownHtml += `
                    <details style="margin-bottom: 0.5rem; background: rgba(0,0,0,0.2); border-radius: 6px; padding: 0.5rem;" ${isOpen}>
                        <summary style="cursor: pointer; font-weight: 600; font-size: 0.85rem; display: flex; justify-content: space-between; align-items: center; outline: none; list-style: none;">
                            <span style="flex:1; padding-right:1rem; display: flex; align-items: center; gap: 0.5rem;">
                                <input type="checkbox" class="profile-cb cm-cb" onclick="event.stopPropagation(); window.handleProfileToggle(this)">
                                <span>▶ ${cmLabel} ${infoHtml}</span>
                            </span>
                            <span style="color: var(--primary-light); white-space: nowrap;">${cmData.total.toLocaleString()} j.</span>
                        </summary>
                        <div style="padding-left: 0.5rem; margin-top: 0.5rem; border-left: 2px solid rgba(255,255,255,0.1);">
                `;

                const sortedGNs = Object.entries(cmData.gns).sort((a, b) => b[1].total - a[1].total);
                sortedGNs.forEach(([gnId, gnData]) => {
                    const gnLabel = state.gnLabels[gnId] || gnId;
                    const displayGnLabel = gnLabel.startsWith(gnId) ? gnLabel : `${gnId} - ${gnLabel}`;

                    const gAge = gnData.dAge > 0 ? gnData.wAge / gnData.dAge : null;
                    const gSexe = gnData.dSexe > 0 ? gnData.wSexe / gnData.dSexe : null;
                    const gAvqp = gnData.dAvqp > 0 ? gnData.wAvqp / gnData.dAvqp : null;
                    const gAvqr = gnData.dAvqr > 0 ? gnData.wAvqr / gnData.dAvqr : null;
                    const gCsarr = gnData.sCsarr > 0 ? gnData.wCsarr / gnData.sCsarr : null;
                    const gnInfoHtml = buildInfoTooltip(displayGnLabel, gAge, gSexe, gAvqp, gAvqr, gCsarr);

                    breakdownHtml += `
                        <details style="margin-bottom: 0.4rem; background: rgba(255,255,255,0.02); padding: 0.3rem; border-radius: 4px;">
                            <summary style="cursor: pointer; font-size: 0.8rem; display: flex; justify-content: space-between; color: #ccc; align-items: center; outline: none; list-style: none;">
                                <span style="flex:1; padding-right:1rem; display: flex; align-items: center; gap: 0.5rem;">
                                    <input type="checkbox" class="profile-cb gn-cb" onclick="event.stopPropagation(); window.handleProfileToggle(this)">
                                    <span title="${displayGnLabel}">▶ ${displayGnLabel.length > 50 ? displayGnLabel.substring(0, 50) + '...' : displayGnLabel} ${gnInfoHtml}</span>
                                </span>
                                <span style="white-space: nowrap;">${gnData.total.toLocaleString()} j.</span>
                            </summary>
                            <div style="padding-left: 1rem; margin-top: 0.4rem; margin-bottom: 0.2rem;">
                    `;

                    const sortedGMEs = Object.entries(gnData.gmes).sort((a, b) => b[1].total - a[1].total);
                    sortedGMEs.forEach(([gmeId, gmeData]) => {
                        const gmeLabel = state.gmeLabels[gmeId] || gmeId;
                        const displayGmeLabel = gmeLabel.startsWith(gmeId) ? gmeLabel : `${gmeId} - ${gmeLabel}`;

                        const hcStr = gmeData.hc > 0 ? `${gmeData.hc.toLocaleString()} HC` : '';
                        const hpStr = gmeData.hp > 0 ? `${gmeData.hp.toLocaleString()} HP` : '';
                        const detailsStr = [hcStr, hpStr].filter(Boolean).join(' / ');

                        const gmeInfoHtml = buildInfoTooltip(displayGmeLabel, gmeData.code.age_moyen, gmeData.code.sexe_ratio, gmeData.code.avq_physique, gmeData.code.avq_relationnel, gmeData.code.nb_actes_csarr);

                        breakdownHtml += `
                                <div class="gme-item" style="display: flex; justify-content: space-between; font-size: 0.75rem; color: #aaa; margin-bottom: 3px; align-items: center;">
                                    <span style="flex:1; padding-right:0.5rem; display: flex; align-items: center; gap: 0.5rem;">
                                        <input type="checkbox" class="profile-cb gme-cb" 
                                            data-days="${gmeData.total}" 
                                            data-age="${gmeData.code.age_moyen}" 
                                            data-sexe="${gmeData.code.sexe_ratio}" 
                                            data-avqp="${gmeData.code.avq_physique}" 
                                            data-avqr="${gmeData.code.avq_relationnel}" 
                                            data-csarr="${gmeData.code.nb_actes_csarr}" 
                                            onclick="event.stopPropagation(); window.handleProfileToggle(this)">
                                        <span title="${displayGmeLabel}">${displayGmeLabel.length > 55 ? displayGmeLabel.substring(0, 55) + '...' : displayGmeLabel} ${gmeInfoHtml}</span>
                                    </span>
                                    <div style="text-align: right;">
                                        <span style="color: var(--text-light); font-weight: 500;">${gmeData.total.toLocaleString()} j.</span>
                                        ${detailsStr ? `<br><span style="font-size: 0.65rem; color: #666;">${detailsStr}</span>` : ''}
                                    </div>
                                </div>
                        `;
                    });

                    breakdownHtml += `</div></details>`;
                });

                breakdownHtml += `</div></details>`;
            });
        } else {
            breakdownHtml += '<p style="font-size: 0.8rem; color: var(--text-muted);">Aucune donnée détaillée disponible.</p>';
        }
        breakdownHtml += '</div>';

        document.getElementById('det-raw').innerHTML = breakdownHtml;
    } else {
        document.getElementById('det-raw').textContent = "Aucun historique disponible.";
        document.getElementById('det-metrics').innerHTML = "";
        document.getElementById('det-smr-metrics').innerHTML = "";
    }
}

export function updateChart(labels, dataArr, hcArr, hpArr) {
    const ctx = document.getElementById('detailChart').getContext('2d');

    // CORRECTION : On utilise mainChartInstance
    if (mainChartInstance) mainChartInstance.destroy();

    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, 'rgba(139, 92, 246, 0.3)');
    gradient.addColorStop(1, 'rgba(139, 92, 246, 0)');

    const datasets = [{
        label: 'Total',
        data: dataArr,
        borderColor: '#a78bfa',
        borderWidth: 2.5,
        pointBackgroundColor: '#fff',
        pointBorderColor: '#8b5cf6',
        pointRadius: 4,
        pointHoverRadius: 6,
        backgroundColor: gradient,
        fill: true,
        tension: 0.3
    }];

    if (hcArr && hcArr.some(v => v > 0)) {
        datasets.push({
            label: 'HC', data: hcArr, borderColor: '#34d399', borderWidth: 1.5,
            pointRadius: 3, pointHoverRadius: 5, backgroundColor: 'transparent',
            fill: false, tension: 0.3, borderDash: [4, 3]
        });
    }
    if (hpArr && hpArr.some(v => v > 0)) {
        datasets.push({
            label: 'HP', data: hpArr, borderColor: '#f59e0b', borderWidth: 1.5,
            pointRadius: 3, pointHoverRadius: 5, backgroundColor: 'transparent',
            fill: false, tension: 0.3, borderDash: [4, 3]
        });
    }

    // CORRECTION : On assigne à mainChartInstance
    mainChartInstance = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: datasets.length > 1, labels: { color: '#94a3b8', boxWidth: 14, font: { size: 10 } } } },
            scales: {
                y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', font: { size: 10 } } },
                x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 } } }
            }
        }
    });
}

let showAllOptions = false;

export async function initActivityFilters() {
    const $cm = $('#filter-cm');
    const $gn = $('#filter-gn');
    const $gme = $('#filter-gme');

    // 1. Initialisation Select2 (Design moderne avec recherche intégrée)
    $cm.select2({ placeholder: "Rechercher ou sélectionner des CM...", width: '100%', allowClear: true });
    $gn.select2({ placeholder: "Rechercher un GN...", width: '100%', allowClear: true });
    $gme.select2({ placeholder: "Rechercher un GME...", width: '100%', allowClear: true });

    // 2. On remplit les CM au démarrage
    state.optionsTree.forEach(cm => {
        if (cm.value === 'ALL') return; // skip pseudo-option
        $cm.append(new Option(`${cm.text}`, cm.value));
    });

    // S'assurer qu'il n'y a pas de sélection résiduelle
    $cm.val(null);
    $cm.trigger('change.select2');

    $('#toggle-show-all').on('change', function () {
        showAllOptions = this.checked;
        // Rebuild GN list according to the new mode
        rebuildAllOptions();
    });

    $('#btn-clear-filters').on('click', function () {
        clearActivityFilters();
    });


    // 3. Événement : Changement de sélection sur les CM
    $cm.on('change', async () => {
        // Normaliser la valeur lue (éliminer valeurs vides)
        let cmVals = $cm.val() || [];
        cmVals = Array.isArray(cmVals) ? cmVals.filter(v => v && v !== 'ALL') : (cmVals ? [cmVals] : []);

        // Toujours vider GME (sera repopulé par GN change)
        $('#filter-gme').empty();
        $('#filter-gme').val(null).trigger('change.select2');

        rebuildAllOptions();

        await applyActivityFilter();
    });


    // 4. Événement : Changement de sélection sur les GN
    $gn.on('change', async () => {
        const cmVals = ($('#filter-cm').val() || []).filter(v => v && v !== 'ALL');
        const gnVals = ($('#filter-gn').val() || []).filter(Boolean);

        const $gme = $('#filter-gme');
        $gme.empty();

        const gmeSeen = new Set(); // Pour éviter les doublons de GME

        if (gnVals.length > 0) {
            // Des GN sont sélectionnés : on affiche uniquement les GME de ces GN
            state.optionsTree.forEach(cmNode => {
                (cmNode.groupes_nosologiques || []).forEach(gnNode => {
                    if (gnVals.includes(gnNode.value)) {
                        (gnNode.groupes_medico_economiques || []).forEach(gme => {
                            if (!gmeSeen.has(gme.value)) {
                                gmeSeen.add(gme.value);
                                $gme.append(new Option(`${gme.text}`, gme.value));
                            }
                        });
                    }
                });
            });
        } else {
            // AUCUN GN N'EST SÉLECTIONNÉ : On repeuple selon le mode (Afficher tout ou CM sélectionnés)
            if (showAllOptions) {
                // Mode "Afficher tout" : on remet absolument tous les GME
                state.optionsTree.forEach(cmNode => {
                    (cmNode.groupes_nosologiques || []).forEach(gnNode => {
                        (gnNode.groupes_medico_economiques || []).forEach(gme => {
                            if (!gmeSeen.has(gme.value)) {
                                gmeSeen.add(gme.value);
                                $gme.append(new Option(gme.text, gme.value));
                            }
                        });
                    });
                });
            } else if (cmVals.length > 0) {
                // Mode restreint : on remet les GME appartenant aux CM sélectionnés
                state.optionsTree.forEach(cmNode => {
                    if (cmVals.includes(cmNode.value)) {
                        (cmNode.groupes_nosologiques || []).forEach(gnNode => {
                            (gnNode.groupes_medico_economiques || []).forEach(gme => {
                                if (!gmeSeen.has(gme.value)) {
                                    gmeSeen.add(gme.value);
                                    $gme.append(new Option(gme.text, gme.value));
                                }
                            });
                        });
                    }
                });
            }
        }

        $gme.val(null).trigger('change.select2');
        await applyActivityFilter();
    });


    // 5. Événement : Changement de sélection sur les GME
    $gme.on('change', async () => {
        await applyActivityFilter();
    });
}

async function applyActivityFilter() {
    // Normalisation : enlever valeurs vides et 'ALL'
    const rawCm = ($('#filter-cm').val() || []);
    const cm = Array.isArray(rawCm) ? rawCm.filter(v => v && v !== 'ALL') : (rawCm ? [rawCm] : []);
    const gn = ($('#filter-gn').val() || []).filter(v => v && v !== '');
    const gme = ($('#filter-gme').val() || []).filter(v => v && v !== '');

    // Si aucun filtre médical actif (ni CM, ni GN, ni GME) -> reset
    const hasAnyMedicalFilter = (cm.length > 0) || (gn.length > 0) || (gme.length > 0);

    // Cas spécial : si showAllOptions activé, on autorise GN même si cm vide
    const allowGnOnly = !!window.showAllOptions;

    if (!hasAnyMedicalFilter && !allowGnOnly) {
        // Pas de filtre du tout -> on remet la map à l'état global
        state.mapCustomData = null;
    } else {
        // On a soit des CM, soit des GN/GME, ou showAllOptions active -> on calcule
        document.body.style.cursor = 'wait';
        const mapBtn = document.getElementById('btn-map');
        const originalText = mapBtn ? mapBtn.textContent : null;
        if (mapBtn) mapBtn.textContent = "Calcul en cours...";

        try {
            // Passer les tableaux tels quels ; fetchMapActivityData doit accepter [] pour cm
            state.mapCustomData = await fetchMapActivityData(cm, gn, gme);
        } catch (err) {
            console.error('Erreur fetchMapActivityData', err);
            state.mapCustomData = null;
        } finally {
            document.body.style.cursor = 'default';
            if (mapBtn) mapBtn.textContent = originalText;
        }
    }

    // Forcer redraw table / stats / map
    if (state.table) {
        state.table.rows().invalidate('data');
        state.table.draw();
        updateGlobalStats();
    }

    if (state.currentView === 'map') {
        refreshViews();
    }
}

function rebuildAllOptions() {
    const $cm = $('#filter-cm');
    const $gn = $('#filter-gn');
    const $gme = $('#filter-gme');
    const cmValsRaw = $cm.val() || [];
    const cmVals = Array.isArray(cmValsRaw) ? cmValsRaw.filter(v => v && v !== 'ALL') : (cmValsRaw ? [cmValsRaw] : []);
    const gnValsRaw = $gn.val() || [];
    const gnVals = Array.isArray(gnValsRaw) ? gnValsRaw.filter(v => v && v !== '') : (gnValsRaw ? [gnValsRaw] : []);

    $gn.empty();
    $gme.empty();

    if (showAllOptions) {
        const gnSeen = new Set();
        const gmeSeen = new Set();

        // Mode "Tous" : On parcourt l'arbre complet (CM > GN > GME)
        state.optionsTree.forEach(cmNode => {
            const gns = cmNode.groupes_nosologiques;
            const safeGns = gns ? gns : [];

            safeGns.forEach(gn => {
                // 1. On liste tous les GN existants
                if (!gnSeen.has(gn.value)) {
                    gnSeen.add(gn.value);
                    $gn.append(new Option(gn.text, gn.value));
                }

                // 2. On liste tous les GME contenus dans ces GN
                const gmes = gn.groupes_medico_economiques;
                const safeGmes = gmes ? gmes : [];

                safeGmes.forEach(gme => {
                    if (!gmeSeen.has(gme.value)) {
                        gmeSeen.add(gme.value);
                        $gme.append(new Option(gme.text, gme.value));
                    }
                });
            });
        });
    } else {
        // Mode restreint : GN uniquement pour les CM sélectionnés
        if (cmVals.length === 0) {
            $gn.val(null).trigger('change.select2');
            return;
        }

        // 1. On remplit les GN avec les CM sélectionnés
        state.optionsTree.filter(c => cmVals.includes(c.value)).forEach(cmNode => {
            (cmNode.groupes_nosologiques || []).forEach(gn => {
                $gn.append(new Option(`${gn.text}`, gn.value));
            });
        });

        // 2. Si aucun GN n'est sélectionné, on arrête là
        if (gnVals.length === 0) {
            $gme.val(null).trigger('change.select2');
            return;
        }

        // On rentre dans les CM sélectionnés, on parcourt leurs GN, et on filtre sur les GN sélectionnés.
        state.optionsTree.filter(c => cmVals.includes(c.value)).forEach(cmNode => {
            (cmNode.groupes_nosologiques || []).forEach(gnNode => {
                // On vérifie si ce GN fait partie des GN sélectionnés par l'utilisateur
                if (gnVals.includes(gnNode.value)) {
                    // Si oui, on ajoute ses GME
                    (gnNode.groupes_medico_economiques || []).forEach(gme => {
                        $gme.append(new Option(`${gme.text}`, gme.value));
                    });
                }
            });
        });
    }

    // notifier Select2 et réinitialiser la sélection GN
    $gn.val(null).trigger('change.select2');
}

function clearActivityFilters() {
    const $cm = $('#filter-cm');
    const $gn = $('#filter-gn');
    const $gme = $('#filter-gme');

    // Vider la sélection CM (aucune valeur sélectionnée)
    $cm.val(null).trigger('change.select2');

    // Vider GN / GME et notifier Select2
    $gn.empty();
    $gme.empty();
    $gn.val(null).trigger('change.select2');
    $gme.val(null).trigger('change.select2');

    // Rebuild GN selon le mode showAllOptions (affichera tous les GN si coché, sinon GN caché)
    rebuildAllOptions();

    // Appliquer le filtre (captureMedicalFilters() doit considérer [] comme "aucun filtre")
    applyActivityFilter();
}

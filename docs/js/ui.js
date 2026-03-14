// js/ui.js
import { state, config } from './state.js';
import { fetchHistory, fetchMapActivityData } from './api.js';
import { refreshViews } from './map.js';

// --- UTILITAIRES POUR LE SECRET STATISTIQUE ---

export function parseDays(val) {
    if (val === undefined || val === null || val === "NA" || val === "N/A" || val === "") {
        return { min: 0, max: 0, isExact: true, mid: 0 };
    }
    if (val === "1 à 10" || val === "< 11") {
        return { min: 1, max: 10, isExact: false, mid: 5.5 };
    }
    const num = parseInt(val) || 0;
    return { min: num, max: num, isExact: true, mid: num };
}

export function addStats(s1, s2) {
    return {
        min: s1.min + s2.min,
        max: s1.max + s2.max,
        isExact: s1.isExact && s2.isExact,
        mid: s1.mid + s2.mid
    };
}

export function formatStat(stat, unit = "j.") {
    const u = unit ? ` ${unit.trim()}` : '';
    if (stat.isExact) return `${stat.min.toLocaleString()}${u}`;

    const icon = `<span title="Inclut des données soumises au secret statistique (< 11)" style="cursor:help; font-size: 0.9em; margin-left:3px; filter: grayscale(1); opacity: 0.8;">🔒</span>`;
    if (stat.min === 1 && stat.max === 10) return `1 à 10${u} ${icon}`;
    return `${stat.min.toLocaleString()} à ${stat.max.toLocaleString()}${u} ${icon}`;
}

// ----------------------------------------------

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
                            const days = parseDays(code.nb_journees_hc).mid + parseDays(code.nb_journees_hp).mid;
                            if (days > 0) total += days;
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

    // --- Sélecteur d'établissement de référence ---
    let selectorHtml = `
        <div style="grid-column: 1 / -1; margin-bottom: 1rem;">
            <label style="font-size:0.85rem; color:var(--text-muted); margin-right:0.5rem;">
                Établissement de référence :
            </label>
            <select id="comparison-reference" class="filter-select">
                <option value="">— Aucun —</option>
                ${allData.map(d => `<option value="${d.finess}">${d.raison_sociale}</option>`).join('')}
            </select>
        </div>
    `;

    // 4. Render Indicator Comparison (Latest Period)
    const indicatorsContent = document.getElementById('comparison-indicators');
    let html = `
        <div style="grid-column: 1 / -1; display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem; margin-bottom: 2rem;">
    `;

    html = selectorHtml + html;

    allData.forEach(d => {
        const lastP = Object.keys(d.periodes).sort().pop();
        const pData = d.periodes[lastP] || {};
        const meta = state.mapping[d.finess];

        let totalDaysStat = parseDays();
        let totalHCStat = parseDays();
        let totalHPStat = parseDays();

        let wSumAge = 0, wDaysAge = 0;
        let wSumSexe = 0, wDaysSexe = 0;
        let wSumAvqp = 0, wDaysAvqp = 0;
        let wSumAvqr = 0, wDaysAvqr = 0;
        let wSumCsarr = 0, wDaysCsarr = 0;

        Object.entries(pData).forEach(([catMaj, gns]) => {
            if (catMaj === 'total') return;
            if (filters.selCms.length > 0 && !filters.selCms.includes(catMaj)) return;
            Object.entries(gns || {}).forEach(([gnId, gmes]) => {
                if (filters.selGns.length > 0 && !filters.selGns.includes(gnId)) return;
                Object.entries(gmes || {}).forEach(([gmeId, code]) => {
                    if (filters.selGmes.length > 0 && !filters.selGmes.includes(gmeId)) return;

                    const hc = parseDays(code.nb_journees_hc);
                    const hp = parseDays(code.nb_journees_hp);
                    const daysStat = addStats(hc, hp);

                    if (daysStat.max > 0) {
                        totalDaysStat = addStats(totalDaysStat, daysStat);
                        totalHCStat = addStats(totalHCStat, hc);
                        totalHPStat = addStats(totalHPStat, hp);

                        const days = daysStat.mid;

                        const age = parseFloat(code.age_moyen);
                        if (!isNaN(age)) { wSumAge += age * days; wDaysAge += days; }
                        const sexe = parseFloat(code.sexe_ratio);
                        if (!isNaN(sexe)) { wSumSexe += sexe * days; wDaysSexe += days; }
                        const avqp = parseFloat(code.avq_physique);
                        if (!isNaN(avqp)) { wSumAvqp += avqp * days; wDaysAvqp += days; }

                        const avqr = parseFloat(code.avq_relationnel);
                        if (!isNaN(avqr)) { wSumAvqr += avqr * days; wDaysAvqr += days; }

                        const csarr = parseFloat(code.nb_actes_csarr);
                        if (!isNaN(csarr)) { wSumCsarr += csarr * days; wDaysCsarr += days; }
                    }
                });
            });
        });

        const avgAge = wDaysAge > 0 ? (wSumAge / wDaysAge).toFixed(1) : "N/C 🔒";
        const avgSexe = wDaysSexe > 0 ? (wSumSexe / wDaysSexe).toFixed(1) : "N/C 🔒";
        const avgAvqp = wDaysAvqp > 0 ? (wSumAvqp / wDaysAvqp).toFixed(2) : "N/C 🔒";
        const avgAvqr = wDaysAvqr > 0 ? (wSumAvqr / wDaysAvqr).toFixed(2) : "N/C 🔒";
        const avgCsarr = wDaysCsarr > 0 ? (wSumCsarr / wDaysCsarr).toFixed(2) : "N/C 🔒";

        html += `
            <div class="stat-card" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1);">
                <div style="font-weight: 600; font-size: 0.9rem; margin-bottom: 0.8rem; color: var(--primary-light);" 
                    title="${d.raison_sociale}">
                    ${d.raison_sociale}
                </div>

                <div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 0.6rem;">
                    <strong>FINESS :</strong> ${d.finess}<br>
                    <strong>Type :</strong> ${meta.categorie || "N/A"}<br>
                    <strong>Région :</strong> ${meta.reg_name || "N/A"}<br>
                    <strong>Département :</strong> ${meta.dep_name} (${meta.dep_code})<br>
                </div>

                <div style="display: flex; justify-content: space-between; margin-bottom: 0.4rem;">
                    <span style="font-size: 0.8rem; color: var(--text-muted);">Âge Moyen</span>
                    <span style="font-weight: 600;">${avgAge !== "N/C 🔒" ? avgAge + " ans" : avgAge}</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.4rem;">
                    <span style="font-size: 0.8rem; color: var(--text-muted);">Sexe Ratio</span>
                    <span style="font-weight: 600;">${avgSexe !== "N/C 🔒" ? avgSexe + "% H" : avgSexe}</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.4rem;">
                    <span style="font-size: 0.8rem; color: var(--text-muted);">AVQ physique</span>
                    <span style="font-weight: 600;">${avgAvqp !== "N/C 🔒" ? avgAvqp + "/4" : avgAvqp}</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.4rem;">
                    <span style="font-size: 0.8rem; color: var(--text-muted);">AVQ relationnel</span>
                    <span style="font-weight: 600;">${avgAvqr !== "N/C 🔒" ? avgAvqr + "/4" : avgAvqr}</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.4rem;">
                    <span style="font-size: 0.8rem; color: var(--text-muted);">Actes CSARR</span>
                    <span style="font-weight: 600;">${avgCsarr !== "N/C 🔒" ? avgCsarr + "/j" : avgCsarr}</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-top: 0.8rem; padding-top: 0.8rem; border-top: 1px solid rgba(255,255,255,0.05);">
                    <span style="font-size: 0.8rem; color: var(--text-muted);">Activité</span>
                    <span style="font-weight: 600; color: var(--primary-light);">${formatStat(totalDaysStat)}</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-top: 0.3rem;">
                    <span style="font-size: 0.75rem; color: var(--text-muted);">HC</span>
                    <span style="font-weight: 600; color: var(--primary-light);">${formatStat(totalHCStat)}</span>
                </div>

                <div style="display: flex; justify-content: space-between;">
                    <span style="font-size: 0.75rem; color: var(--text-muted);">HP</span>
                    <span style="font-weight: 600; color: var(--primary-light);">${formatStat(totalHPStat)}</span>
                </div>

            </div>
        `;
    });

    html += `</div>`;
    indicatorsContent.innerHTML = html;

    renderMultiRadar(allData);

    // 5. Render comparison profile
    initComparisonTabs();
    const refSelect = document.getElementById('comparison-reference');

    // 1. Installer l'événement onchange
    refSelect.onchange = () => {
        if (!refSelect.value) {
            document.getElementById('comparison-tabs').style.display = 'none';
            return;
        }
        computeComparisonProfile(allData);
    };

    // 2. Auto‑sélection si 2 établissements
    if (allData.length === 2) {
        refSelect.value = String(allData[0].finess);
        computeComparisonProfile(allData);
    }

    // 3. Si rien n'est sélectionné → masquer tout
    if (!refSelect.value) {
        document.getElementById('comparison-tabs').style.display = 'none';
        return;
    }
}

function computeProfile(est, filters) {
    const lastP = Object.keys(est.periodes).sort().pop();
    const pData = est.periodes[lastP] || {};

    let totalDays = 0;
    let wAge = 0, dAge = 0;
    let wSexe = 0, dSexe = 0;
    let wAvqp = 0, dAvqp = 0;
    let wAvqr = 0, dAvqr = 0;
    let wCsarr = 0, dCsarr = 0;

    Object.entries(pData).forEach(([catMaj, gns]) => {
        if (catMaj === 'total') return;
        if (filters.selCms.length > 0 && !filters.selCms.includes(catMaj)) return;

        Object.entries(gns || {}).forEach(([gnId, gmes]) => {
            if (filters.selGns.length > 0 && !filters.selGns.includes(gnId)) return;

            Object.entries(gmes || {}).forEach(([gmeId, code]) => {
                if (filters.selGmes.length > 0 && !filters.selGmes.includes(gmeId)) return;

                const days = parseDays(code.nb_journees_hc).mid + parseDays(code.nb_journees_hp).mid;
                if (days === 0) return;

                totalDays += days;

                const age = parseFloat(code.age_moyen);
                if (!isNaN(age)) { wAge += age * days; dAge += days; }

                const sexe = parseFloat(code.sexe_ratio);
                if (!isNaN(sexe)) { wSexe += sexe * days; dSexe += days; }

                const avqp = parseFloat(code.avq_physique);
                if (!isNaN(avqp)) { wAvqp += avqp * days; dAvqp += days; }

                const avqr = parseFloat(code.avq_relationnel);
                if (!isNaN(avqr)) { wAvqr += avqr * days; dAvqr += days; }

                const csarr = parseFloat(code.nb_actes_csarr);
                if (!isNaN(csarr)) { wCsarr += csarr * days; dCsarr += days; }
            });
        });
    });

    return {
        age: dAge > 0 ? wAge / dAge : null,
        sexe: dSexe > 0 ? wSexe / dSexe : null,
        avqp: dAvqp > 0 ? wAvqp / dAvqp : null,
        avqr: dAvqr > 0 ? wAvqr / dAvqr : null,
        csarr: dCsarr > 0 ? wCsarr / dCsarr : null
    };
}

function average(arr) {
    const vals = arr.filter(v => v !== null && !isNaN(v));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

function initComparisonTabs() {
    const buttons = document.querySelectorAll('.tab-btn');
    const panels = document.querySelectorAll('.tab-panel');

    buttons.forEach(btn => {
        btn.onclick = () => {
            buttons.forEach(b => b.classList.remove('active'));
            panels.forEach(p => p.style.display = 'none');
            btn.classList.add('active');
            const tab = btn.dataset.tab;
            document.getElementById(`tab-${tab}`).style.display = 'block';
        };
    });
}

let comparisonProfileChartInstance = null;

function computeComparisonProfile(allData) {
    const refFiness = document.getElementById('comparison-reference').value;
    if (!refFiness) {
        document.getElementById('comparison-tabs').style.display = 'none';
        return;
    }
    document.getElementById('comparison-tabs').style.display = 'block';

    const filters = window.currentMedicalFilters || { selCms: [], selGns: [], selGmes: [], hasFilter: false };

    const ref = allData.find(d => String(d.finess) === String(refFiness));
    if (!ref) return;

    const others = allData.filter(d => String(d.finess) !== String(refFiness));

    const refProfile = computeProfile(ref, filters);
    const otherProfiles = others.map(d => computeProfile(d, filters));

    const avg = {
        age: average(otherProfiles.map(p => p.age)),
        sexe: average(otherProfiles.map(p => p.sexe)),
        avqp: average(otherProfiles.map(p => p.avqp)),
        avqr: average(otherProfiles.map(p => p.avqr)),
        csarr: average(otherProfiles.map(p => p.csarr))
    };

    const labels = ['Âge', 'Sexe (%H)', 'AVQ Physique', 'AVQ Relationnel', 'CSARR'];
    const refValues = [refProfile.age, refProfile.sexe, refProfile.avqp, refProfile.avqr, refProfile.csarr];
    const avgValues = [avg.age, avg.sexe, avg.avqp, avg.avqr, avg.csarr];

    const ctx = document.getElementById('comparisonProfileChart').getContext('2d');
    if (comparisonProfileChartInstance) comparisonProfileChartInstance.destroy();

    comparisonProfileChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: ref.raison_sociale,
                    data: refValues,
                    backgroundColor: 'rgba(56, 189, 248, 0.5)',
                    borderColor: '#38bdf8',
                    borderWidth: 1
                },
                {
                    label: 'Moyenne Autres',
                    data: avgValues,
                    backgroundColor: 'rgba(139, 92, 246, 0.5)',
                    borderColor: '#a78bfa',
                    borderWidth: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom' } },
            scales: {
                y: { grid: { color: 'rgba(255,255,255,0.05)' } },
                x: { grid: { display: false } }
            }
        }
    });

    computeComparisonSummary(refProfile, avg, ref.raison_sociale);
    computeComparisonDiff(refProfile, avg, ref.raison_sociale);
    computeComparisonRadar(refProfile, avg, ref.raison_sociale);
}

let comparisonDiffChartInstance = null;

function computeComparisonDiff(refProfile, avgProfile, refName) {

    const diffAge = (refProfile.age && avgProfile.age) ? ((refProfile.age - avgProfile.age) / avgProfile.age) * 100 : 0;
    const diffSexe = (refProfile.sexe && avgProfile.sexe) ? ((refProfile.sexe - avgProfile.sexe) / avgProfile.sexe) * 100 : 0;
    const diffAvqp = (refProfile.avqp && avgProfile.avqp) ? ((refProfile.avqp - avgProfile.avqp) / avgProfile.avqp) * 100 : 0;
    const diffAvqr = (refProfile.avqr && avgProfile.avqr) ? ((refProfile.avqr - avgProfile.avqr) / avgProfile.avqr) * 100 : 0;
    const diffCsarr = (refProfile.csarr && avgProfile.csarr) ? ((refProfile.csarr - avgProfile.csarr) / avgProfile.csarr) * 100 : 0;

    const diffs = [diffAge, diffSexe, diffAvqp, diffAvqr, diffCsarr];

    const ctx = document.getElementById('comparisonDiffChart').getContext('2d');
    if (comparisonDiffChartInstance) comparisonDiffChartInstance.destroy();

    comparisonDiffChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Âge Moyen', 'Sexe Ratio (%H)', 'AVQ Physique', 'AVQ Relationnel', 'Actes CSARR'],
            datasets: [{
                label: `Écart % (${refName} vs Moyenne Autres)`,
                data: diffs,
                backgroundColor: diffs.map(v => v >= 0 ? 'rgba(74, 222, 128, 0.5)' : 'rgba(248, 113, 113, 0.5)'),
                borderColor: diffs.map(v => v >= 0 ? 'rgb(74, 222, 128)' : 'rgb(248, 113, 113)'),
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: ctx => `${ctx.raw.toFixed(1)}%`
                    }
                }
            },
            scales: {
                y: { grid: { color: 'rgba(255,255,255,0.05)' } },
                x: { grid: { display: false } }
            }
        }
    });
}

let comparisonRadarChartInstance = null;

function computeComparisonRadar(refProfile, avgProfile, refName) {
    const labels = ['Âge', 'Sexe (%H)', 'AVQ Physique', 'AVQ Relationnel', 'CSARR'];
    const refValues = [refProfile.age, refProfile.sexe, refProfile.avqp, refProfile.avqr, refProfile.csarr];
    const avgValues = [avgProfile.age, avgProfile.sexe, avgProfile.avqp, avgProfile.avqr, avgProfile.csarr];

    const ctx = document.getElementById('comparisonRadarChart').getContext('2d');
    if (comparisonRadarChartInstance) comparisonRadarChartInstance.destroy();

    comparisonRadarChartInstance = new Chart(ctx, {
        type: 'radar',
        data: {
            labels,
            datasets: [
                {
                    label: refName,
                    data: refValues,
                    backgroundColor: 'rgba(56, 189, 248, 0.3)',
                    borderColor: '#38bdf8',
                    borderWidth: 2,
                    pointRadius: 3
                },
                {
                    label: 'Moyenne Autres',
                    data: avgValues,
                    backgroundColor: 'rgba(139, 92, 246, 0.3)',
                    borderColor: '#a78bfa',
                    borderWidth: 2,
                    pointRadius: 3
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                r: {
                    ticks: { display: false },
                    grid: { color: 'rgba(255,255,255,0.1)' },
                    angleLines: { color: 'rgba(255,255,255,0.1)' },
                    pointLabels: { color: '#cbd5e1' }
                }
            }
        }
    });
}

let comparisonRadarMultiChartInstance = null;

function renderMultiRadar(allData) {
    const filters = window.currentMedicalFilters || { selCms: [], selGns: [], selGmes: [], hasFilter: false };

    const profiles = allData.map(est => ({
        name: est.raison_sociale,
        profile: computeProfile(est, filters)
    }));

    const labels = ['Âge (ans)', 'Sexe Ratio (%H)', 'AVQ Physique (/4)', 'AVQ Relationnel (/4)', 'CSARR (/j)'];

    const datasets = profiles.map((p, idx) => {
        const colors = ['#38bdf8', '#a78bfa', '#34d399', '#f59e0b', '#f43f5e', '#fbbf24'];
        const color = colors[idx % colors.length];

        return {
            label: p.name,
            data: [
                p.profile.age,
                p.profile.sexe,
                p.profile.avqp,
                p.profile.avqr,
                p.profile.csarr
            ],
            backgroundColor: color + '33',
            borderColor: color,
            borderWidth: 2,
            pointRadius: 3
        };
    });

    const container = document.getElementById('comparison-radar-multi');
    container.style.display = 'block';

    const ctx = document.getElementById('comparisonRadarMultiChart').getContext('2d');
    if (comparisonRadarMultiChartInstance) comparisonRadarMultiChartInstance.destroy();

    comparisonRadarMultiChartInstance = new Chart(ctx, {
        type: 'radar',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                r: {
                    ticks: { display: false },
                    grid: { color: 'rgba(255,255,255,0.1)' },
                    angleLines: { color: 'rgba(255,255,255,0.1)' },
                    pointLabels: { color: '#cbd5e1' }
                }
            },
            plugins: {
                legend: { position: 'bottom' }
            }
        }
    });
}

function computeComparisonSummary(refProfile, avgProfile, refName) {
    const container = document.getElementById('comparison-summary');
    container.style.display = 'block';

    const diffs = {
        'Âge moyen': refProfile.age - avgProfile.age,
        'Sexe (%H)': refProfile.sexe - avgProfile.sexe,
        'AVQ Physique': refProfile.avqp - avgProfile.avqp,
        'AVQ Relationnel': refProfile.avqr - avgProfile.avqr,
        'Actes CSARR': refProfile.csarr - avgProfile.csarr
    };

    const positives = Object.entries(diffs)
        .filter(([k, v]) => v < 0)
        .map(([k, v]) => `<li>${k} meilleur que la moyenne des autres (${v.toFixed(2)})</li>`);

    const negatives = Object.entries(diffs)
        .filter(([k, v]) => v > 0)
        .map(([k, v]) => `<li>${k} moins bon que la moyenne des autres (+${v.toFixed(2)})</li>`);

    container.innerHTML = `
        <div class="section-title" style="margin-bottom:0.5rem;">Résumé du profil : ${refName}</div>

        <div style="margin-bottom:1rem;">
            <strong style="color:#4ade80;">Points forts</strong>
            <ul>${positives.join('') || "<li>Aucun écart favorable notable</li>"}</ul>
        </div>

        <div>
            <strong style="color:#f87171;">Points faibles</strong>
            <ul>${negatives.join('') || "<li>Aucun écart défavorable notable</li>"}</ul>
        </div>
    `;
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
                    mergedData.periodes[periode] = fileData.periodes[periode];
                });
            }
        });

        renderDetails(mergedData);

    } catch (err) {
        console.error("Erreur lors du chargement de l'établissement :", err);
        document.getElementById('det-raw').innerHTML = `<span style="color: #ef4444">⚠️ ${err.message}</span>`;
        if (mainChartInstance) mainChartInstance.destroy();
        document.getElementById('det-metrics').innerHTML = "";
        document.getElementById('det-smr-metrics').innerHTML = "";
        document.getElementById('det-meta-top').innerHTML = "";
    }
}

function closeDetails() {
    document.getElementById('detail-view').style.display = 'none';
    document.getElementById('comparison-view').style.display = 'none';
    const refSelect = document.getElementById('comparison-reference');
    if (refSelect) {
        refSelect.value = "";
    }
}

window.closeDetails = closeDetails;

document.addEventListener('keydown', function (event) {
    if (event.key === "Escape" || event.key === "Esc") {
        closeDetails();
    }
});

let mainChartInstance = null;
let profilingChartInstance = null;
let indicatorTrendChartInstance = null;
let comparisonChartInstance = null;
let lastComparisonData = null;

// 1. Fonction qui gère les cases à cocher de l'arbre
window.handleProfileToggle = function (cb) {
    const isChecked = cb.checked;

    if (cb.classList.contains('cm-cb') || cb.classList.contains('gn-cb')) {
        const container = cb.closest('details');
        if (container) {
            const descendants = container.querySelectorAll('.profile-cb');
            descendants.forEach(d => {
                d.checked = isChecked;
                d.indeterminate = false;
            });
        }
    }

    let currentItem = cb.closest('.gme-item') || cb.closest('details');
    while (currentItem) {
        let parentDetails = currentItem.parentElement.closest('details');
        if (!parentDetails) break;

        let parentCb = parentDetails.querySelector(':scope > summary .profile-cb');
        if (!parentCb) break;

        let childrenContainer = parentDetails.querySelector(':scope > div');
        if (!childrenContainer) break;

        let childCbs = Array.from(childrenContainer.children)
            .map(el => {
                if (!el || el.nodeType !== Node.ELEMENT_NODE) return null;

                if (el.classList.contains('gme-item') || el.classList.contains('gn-item')) {
                    return el.querySelector('.profile-cb');
                }

                if (el.tagName === 'DETAILS') {
                    return el.querySelector(':scope > summary .profile-cb');
                }

                return null;
            })
            .filter(Boolean);

        const allChecked = childCbs.length > 0 && childCbs.every(c => c.checked);
        const someChecked = childCbs.some(c => c.checked || c.indeterminate);

        parentCb.checked = allChecked;
        parentCb.indeterminate = (!allChecked && someChecked);

        currentItem = parentDetails;
    }

    window.updateProfileChart();
};

// 2. Fonction qui dessine le graphique "Profil de l'Activité Sélectionnée"
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
        // on a stocké gmeData.total.mid dans data-days
        const days = parseFloat(cb.dataset.days) || 0;
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
                            return `${val} (Profil: ${sel} vs Global/Filtre: ${globV})`;
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
                    const days = parseDays(code.nb_journees_hc).mid + parseDays(code.nb_journees_hp).mid;

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

    section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

function updateDeptFilter() {
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

export function captureMedicalFilters() {
    const selCms = ($('#filter-cm').val() || []).filter(v => v && v !== 'ALL');
    const selGns = ($('#filter-gn').val() || []).filter(Boolean);
    const selGmes = ($('#filter-gme').val() || []).filter(Boolean);
    const hasFilter = selCms.length > 0 || selGns.length > 0 || selGmes.length > 0;

    window.currentMedicalFilters = { selCms, selGns, selGmes, hasFilter };
    return window.currentMedicalFilters;
}

function isRange(value) {
    return typeof value === "string" && value.includes("-");
}

export function renderDetails(data) {
    const periodes = Object.keys(data.periodes || {}).sort();
    const filters = captureMedicalFilters();

    document.getElementById('indicator-trend-section').style.display = 'none';
    document.getElementById('profiling-section').style.display = 'none';
    document.querySelectorAll('.profile-cb').forEach(cb => { cb.checked = false; cb.indeterminate = false; });

    document.getElementById('det-meta-top').innerHTML = `
    <div style="display:flex; gap:0.5rem; flex-wrap: wrap;">
        <span class="badge">FINESS ${data.finess}</span>
        <span class="badge" style="color:var(--primary-light)">${data.geo?.categorie || 'N/A'}</span>
        <span class="badge" style="color:var(--text-muted)">MàJ ${data.site_updated_at || 'Jan 2026'}</span>
        <span class="badge" style="background: rgba(139, 92, 246, 0.1); color: #a78bfa; border: 1px solid rgba(139, 92, 246, 0.2);">Historique : ${data.sources?.length || 0} fichiers</span>
    </div>`;

    const baseTitle = data.raison_sociale || "Établissement inconnu";
    const isFiltered = filters?.hasFilter === true;
    document.getElementById('det-name').textContent = isFiltered ? `📉 ${baseTitle} (Filtré)` : baseTitle;

    if (periodes.length > 0) {
        const labels = periodes;

        const sumForPeriod = (p, field) => {
            let total = { min: 0, max: 0, isExact: true, mid: 0 };
            Object.entries(data.periodes[p] || {}).forEach(([catMaj, gns]) => {
                if (catMaj === 'total') return;
                if (filters.selCms.length > 0 && !filters.selCms.includes(catMaj)) return;
                Object.entries(gns || {}).forEach(([gnId, gmes]) => {
                    if (filters.selGns.length > 0 && !filters.selGns.includes(gnId)) return;
                    Object.entries(gmes || {}).forEach(([gmeId, code]) => {
                        if (filters.selGmes.length > 0 && !filters.selGmes.includes(gmeId)) return;
                        total = addStats(total, parseDays(code[field]));
                    });
                });
            });
            return total;
        };

        const valuesStat = labels.map(p => addStats(sumForPeriod(p, 'nb_journees_hc'), sumForPeriod(p, 'nb_journees_hp')));
        const hcValuesStat = labels.map(p => sumForPeriod(p, 'nb_journees_hc'));
        const hpValuesStat = labels.map(p => sumForPeriod(p, 'nb_journees_hp'));

        window.allPeriodes = { labels, rawData: data.periodes };

        // Pour ChartJS on utilise .mid (valeur continue)
        updateChart(
            labels,
            valuesStat.map(v => v.mid),
            hcValuesStat.map(v => v.mid),
            hpValuesStat.map(v => v.mid)
        );

        const lastP = periodes[periodes.length - 1];
        let hcStat = parseDays();
        let hpStat = parseDays();

        const catMajBreakdown = {};
        const fullBreakdown = {};

        let totalDaysForAge = 0, weightedSumAge = 0;
        let totalDaysForSexe = 0, weightedSumSexe = 0;
        let totalDaysForAVQP = 0, weightedSumAVQP = 0;
        let totalDaysForAVQR = 0, weightedSumAVQR = 0;
        let totalStaysForCSARR = 0, weightedSumCSARR = 0;

        Object.entries(data.periodes[lastP] || {}).forEach(([catMaj, gns]) => {
            if (catMaj === 'total') return;
            if (filters.selCms.length > 0 && !filters.selCms.includes(catMaj)) return;

            fullBreakdown[catMaj] = { total: parseDays(), gns: {}, wAge: 0, dAge: 0, wSexe: 0, dSexe: 0, wAvqp: 0, dAvqp: 0, wAvqr: 0, dAvqr: 0, wCsarr: 0, sCsarr: 0 };

            Object.entries(gns || {}).forEach(([gnId, gmes]) => {
                if (filters.selGns.length > 0 && !filters.selGns.includes(gnId)) return;
                fullBreakdown[catMaj].gns[gnId] = { total: parseDays(), gmes: {}, wAge: 0, dAge: 0, wSexe: 0, dSexe: 0, wAvqp: 0, dAvqp: 0, wAvqr: 0, dAvqr: 0, wCsarr: 0, sCsarr: 0 };

                Object.entries(gmes || {}).forEach(([gmeId, code]) => {
                    if (filters.selGmes.length > 0 && !filters.selGmes.includes(gmeId)) return;

                    const c_hc = parseDays(code.nb_journees_hc);
                    const c_hp = parseDays(code.nb_journees_hp);
                    const daysStat = addStats(c_hc, c_hp);

                    if (daysStat.max > 0) {
                        hcStat = addStats(hcStat, c_hc);
                        hpStat = addStats(hpStat, c_hp);

                        fullBreakdown[catMaj].gns[gnId].total = addStats(fullBreakdown[catMaj].gns[gnId].total, daysStat);
                        fullBreakdown[catMaj].total = addStats(fullBreakdown[catMaj].total, daysStat);
                        fullBreakdown[catMaj].gns[gnId].gmes[gmeId] = { total: daysStat, code: code, hc: c_hc, hp: c_hp };

                        const days = daysStat.mid;

                        const age = parseFloat(code.age_moyen);
                        if (!isNaN(age)) {
                            weightedSumAge += age * days; totalDaysForAge += days;
                            fullBreakdown[catMaj].wAge += age * days; fullBreakdown[catMaj].dAge += days;
                            fullBreakdown[catMaj].gns[gnId].wAge += age * days; fullBreakdown[catMaj].gns[gnId].dAge += days;
                        }

                        const sexe = parseFloat(code.sexe_ratio);
                        if (!isNaN(sexe)) {
                            weightedSumSexe += sexe * days; totalDaysForSexe += days;
                            fullBreakdown[catMaj].wSexe += sexe * days; fullBreakdown[catMaj].dSexe += days;
                            fullBreakdown[catMaj].gns[gnId].wSexe += sexe * days; fullBreakdown[catMaj].gns[gnId].dSexe += days;
                        }

                        const avqp = parseFloat(code.avq_physique);
                        if (!isNaN(avqp)) {
                            weightedSumAVQP += avqp * days; totalDaysForAVQP += days;
                            fullBreakdown[catMaj].wAvqp += avqp * days; fullBreakdown[catMaj].dAvqp += days;
                            fullBreakdown[catMaj].gns[gnId].wAvqp += avqp * days; fullBreakdown[catMaj].gns[gnId].dAvqp += days;
                        }

                        const avqr = parseFloat(code.avq_relationnel);
                        if (!isNaN(avqr)) {
                            weightedSumAVQR += avqr * days; totalDaysForAVQR += days;
                            fullBreakdown[catMaj].wAvqr += avqr * days; fullBreakdown[catMaj].dAvqr += days;
                            fullBreakdown[catMaj].gns[gnId].wAvqr += avqr * days; fullBreakdown[catMaj].gns[gnId].dAvqr += days;
                        }

                        const csarr = parseFloat(code.nb_actes_csarr);
                        if (!isNaN(csarr)) {
                            weightedSumCSARR += csarr * days; totalStaysForCSARR += days;
                            fullBreakdown[catMaj].wCsarr += csarr * days; fullBreakdown[catMaj].sCsarr += days;
                            fullBreakdown[catMaj].gns[gnId].wCsarr += csarr * days; fullBreakdown[catMaj].gns[gnId].sCsarr += days;
                        }
                    }
                });
                if (fullBreakdown[catMaj].gns[gnId].total.max === 0) delete fullBreakdown[catMaj].gns[gnId];
            });
            if (fullBreakdown[catMaj].total.max === 0) delete fullBreakdown[catMaj];
        });

        const avgAge = totalDaysForAge > 0 ? (weightedSumAge / totalDaysForAge).toFixed(1) : "N/C 🔒";
        const avgSexe = totalDaysForSexe > 0 ? (weightedSumSexe / totalDaysForSexe).toFixed(1) : "N/C 🔒";
        const avgAVQP = totalDaysForAVQP > 0 ? (weightedSumAVQP / totalDaysForAVQP).toFixed(2) : "N/C 🔒";
        const avgAVQR = totalDaysForAVQR > 0 ? (weightedSumAVQR / totalDaysForAVQR).toFixed(2) : "N/C 🔒";
        const avgCSARR = totalStaysForCSARR > 0 ? (weightedSumCSARR / totalStaysForCSARR).toFixed(2) : "N/C 🔒";

        window.globalMetrics = { avgAge, avgSexe, avgAVQP, avgAVQR, avgCSARR };

        let official = {};

        const periode = data.periodes[lastP] || {};

        // Aucun filtre → on prend les totaux globaux
        if (!filters.hasFilter) {
            official = periode.total || {};
        }

        // Filtre CM → on prend le total du CM sélectionné
        else if (filters.selCms.length === 1 && filters.selGns.length === 0 && filters.selGmes.length === 0) {
            official = periode.cm?.[filters.selCms[0]]?.total || {};
        }

        // Filtre GN → on prend le total du GN sélectionné
        else if (filters.selGns.length === 1 && filters.selCms.length < 2 && filters.selGmes.length === 0) {
            official = periode.gn?.[filters.selGns[0]]?.total || {};
        }

        // Filtre GME → pas de total officiel pertinent
        else {
            official = {}; // on désactive les comparaisons officielles
        }

        const secrecyInfo = `<span title="Les totaux affichés incluent potentiellement des données masquées par le secret statistique ('1 à 10' j.). Celles-ci sont transformées en intervalles." style="cursor:help; font-size: 0.8em; vertical-align: middle;">ℹ️</span>`;

        // Fonction compare pour les intervalles
        const compare = (calcStat, off, unit = "") => {
            const calcHtml = formatStat(calcStat, unit);

            // Si filtre actif → on ignore complètement les valeurs officielles
            if (filters.hasFilter || !off) {
                return { text: calcHtml, match: true, showOff: false };
            }

            // Cas 1 : plage officielle (secret statistique)
            if (isRange(off)) {
                return {
                    text: `${calcHtml} <span style="font-size:0.8em; color:#666">(plage off. ${off})</span>`,
                    match: false,
                    showOff: true
                };
            }

            // Cas 2 : valeur numérique
            const offVal = parseInt(off.toString().replace(/\s/g, ''));
            const margin = offVal * 0.05;

            const inside =
                offVal >= (calcStat.min - margin) &&
                offVal <= (calcStat.max + margin);

            //if (inside) {
            //    return { text: calcHtml, match: true, showOff: false };
            //}

            return {
                text: `${calcHtml} <span style="font-size:0.8em; color:#666">(off. ${offVal.toLocaleString()})</span>`,
                match: false,
                showOff: true
            };
        };

        // Fonction compare pour les moyennes scalaires
        const compareAvg = (calc, off, unit = "") => {
            const unitHtml = unit ? ` ${unit.trim()}` : '';

            if (calc.includes("N/C")) {
                return {
                    text: `<span class="muted" title="Donnée couverte par le secret statistique">${calc}</span>`,
                    match: true,
                    showOff: false
                };
            }

            if (filters.hasFilter || !off || off === "NA") {
                return { text: `${calc}${unitHtml}`, match: true, showOff: false };
            }

            if (isRange(off)) {
                return {
                    text: `${calc}${unitHtml} <span style="font-size:0.8em; color:#666">(plage off. ${off})</span>`,
                    match: false,
                    showOff: true
                };
            }

            const c = parseFloat(calc.toString().replace(/\s/g, ''));
            const o = parseFloat(off.toString().replace(/\s/g, ''));

            //if (isNaN(c) || isNaN(o) || Math.abs(c - o) <= (o * 0.05)) {
            //    return { text: `${calc}${unitHtml}`, match: true, showOff: false };
            //}

            return {
                text: `${calc}${unitHtml} <span style="font-size:0.8em; color:#666">(off. ${off.toLocaleString()})</span>`,
                match: false,
                showOff: true
            };
        };

        const totalResStat = addStats(hcStat, hpStat);
        const totalRes = compare(totalResStat, official.nb_journees_total, "j.");
        const hcRes = compare(hcStat, official.nb_journees_hc, "j.");
        const hpRes = compare(hpStat, official.nb_journees_hp, "j.");

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

        const sectionTitles = document.querySelectorAll('#detail-content .section-title');
        sectionTitles.forEach(el => {
            if (el.textContent.includes("Dernière Période Connue") || el.textContent.includes("Période ")) {
                el.textContent = `Période ¹${lastP}`.replace('¹', '');
            }
        });

        document.getElementById('det-smr-metrics').innerHTML = `
        <div class="metric-card" style="cursor: pointer;" onclick="window.showIndicatorTrend('age_moyen', 'Âge Moyen', 'ans')">
            <div class="metric-label">Âge Moyen <span style="font-size:0.7em; color: var(--text-muted);">(évolution ▶)</span></div>
            <div class="metric-value">${compareAvg(avgAge, official.age_moyen, "ans").text}</div>
        </div>
        <div class="metric-card" style="cursor: pointer;" onclick="window.showIndicatorTrend('sexe_ratio', 'Sexe Ratio', '%H')">
            <div class="metric-label">Sexe Ratio <span style="font-size:0.7em; color: var(--text-muted);">(évolution ▶)</span></div>
            <div class="metric-value">${compareAvg(avgSexe, official.sexe_ratio, "% H").text}</div>
        </div>
        <div class="metric-card" style="cursor: pointer;" onclick="window.showIndicatorTrend('avq_physique', 'AVQ Physique', '/4')">
            <div class="metric-label">AVQ Physique <span style="font-size:0.7em; color: var(--text-muted);">(évolution ▶)</span></div>
            <div class="metric-value">${compareAvg(avgAVQP, official.avq_physique, "/4").text}</div>
        </div>
        <div class="metric-card" style="cursor: pointer;" onclick="window.showIndicatorTrend('avq_relationnel', 'AVQ Relationnel', '/4')">
            <div class="metric-label">AVQ Relationnel <span style="font-size:0.7em; color: var(--text-muted);">(évolution ▶)</span></div>
            <div class="metric-value">${compareAvg(avgAVQR, official.avq_relationnel, "/4").text}</div>
        </div>
        <div class="metric-card" style="cursor: pointer;" onclick="window.showIndicatorTrend('nb_actes_csarr', 'Actes CSARR', '/j.')">
            <div class="metric-label">Actes CSARR <span style="font-size:0.7em; color: var(--text-muted);">(évolution ▶)</span></div>
            <div class="metric-value">${compareAvg(avgCSARR, official.nb_actes_csarr, "/j.").text}</div>
        </div>
        `;

        const buildInfoTooltip = (title, age, sexe, avqp, avqr, csarr) => {
            let parts = [];
            if (age && !isNaN(parseFloat(age))) parts.push(`Âge moyen: ${parseFloat(age).toFixed(1)} ans`);
            if (sexe && !isNaN(parseFloat(sexe))) parts.push(`Sexe Ratio: ${parseFloat(sexe).toFixed(1)}% H`);
            if (avqp && !isNaN(parseFloat(avqp))) parts.push(`AVQ Physique: ${parseFloat(avqp).toFixed(2)} /4`);
            if (avqr && !isNaN(parseFloat(avqr))) parts.push(`AVQ Relationnel: ${parseFloat(avqr).toFixed(2)} /4`);
            if (csarr && !isNaN(parseFloat(csarr))) parts.push(`Actes CSARR: ${parseFloat(csarr).toFixed(2)} /j.`);
            if (parts.length === 0) return '';
            return `<span title="Indicateurs pour '${title.replace(/"/g, '&quot;')}':&#10;${parts.join('&#10;')}" style="cursor:help; font-size: 0.9em; vertical-align: middle; filter: grayscale(1); opacity: 0.6; margin-left: 0.3rem;">ℹ️</span>`;
        };

        let breakdownHtml = ''

        // Tri via `.total.mid` pour classer rigoureusement les intervalles
        const sortedCMs = Object.entries(fullBreakdown).sort((a, b) => b[1].total.mid - a[1].total.mid);

        if (sortedCMs.length > 0) {
            sortedCMs.forEach(([cmId, cmData]) => {
                const cmLabel = state.catMajLabels[cmId] || cmId;
                const cAge = cmData.dAge > 0 ? cmData.wAge / cmData.dAge : null;
                const cSexe = cmData.dSexe > 0 ? cmData.wSexe / cmData.dSexe : null;
                const cAvqp = cmData.dAvqp > 0 ? cmData.wAvqp / cmData.dAvqp : null;
                const cAvqr = cmData.dAvqr > 0 ? cmData.wAvqr / cmData.dAvqr : null;
                const cCsarr = cmData.sCsarr > 0 ? cmData.wCsarr / cmData.sCsarr : null;
                const infoHtml = buildInfoTooltip(cmLabel, cAge, cSexe, cAvqp, cAvqr, cCsarr);

                const isOpen = sortedCMs.length <= 2 ? 'open' : '';
                breakdownHtml += `
                    <details style="margin-bottom: 0.5rem; background: rgba(0,0,0,0.2); border-radius: 6px; padding: 0.5rem;" ${isOpen}>
                        <summary style="cursor: pointer; font-weight: 600; font-size: 0.85rem; display: flex; justify-content: space-between; align-items: center; outline: none; list-style: none;">
                            <span style="flex:1; padding-right:1rem; display: flex; align-items: center; gap: 0.5rem;">
                                <input type="checkbox" class="profile-cb cm-cb" onclick="event.stopPropagation(); window.handleProfileToggle(this)">
                                <span>▶ ${cmLabel} ${infoHtml}</span>
                            </span>
                            <span style="color: var(--primary-light); white-space: nowrap;">${formatStat(cmData.total)}</span>
                        </summary>
                        <div style="padding-left: 0.5rem; margin-top: 0.5rem; border-left: 2px solid rgba(255,255,255,0.1);">
                `;

                const sortedGNs = Object.entries(cmData.gns).sort((a, b) => b[1].total.mid - a[1].total.mid);
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
                                <span style="white-space: nowrap;">${formatStat(gnData.total)}</span>
                            </summary>
                            <div style="padding-left: 1rem; margin-top: 0.4rem; margin-bottom: 0.2rem;">
                    `;

                    const sortedGMEs = Object.entries(gnData.gmes).sort((a, b) => b[1].total.mid - a[1].total.mid);
                    sortedGMEs.forEach(([gmeId, gmeData]) => {
                        const gmeLabel = state.gmeLabels[gmeId] || gmeId;
                        const displayGmeLabel = gmeLabel.startsWith(gmeId) ? gmeLabel : `${gmeId} - ${gmeLabel}`;

                        const hcStr = gmeData.hc.max > 0 ? `${formatStat(gmeData.hc, 'HC')}` : '';
                        const hpStr = gmeData.hp.max > 0 ? `${formatStat(gmeData.hp, 'HP')}` : '';
                        const detailsStr = [hcStr, hpStr].filter(Boolean).join(' <span style="color:#666">/</span> ');

                        const gmeInfoHtml = buildInfoTooltip(displayGmeLabel, gmeData.code.age_moyen, gmeData.code.sexe_ratio, gmeData.code.avq_physique, gmeData.code.avq_relationnel, gmeData.code.nb_actes_csarr);

                        breakdownHtml += `
                                <div class="gme-item" style="display: flex; justify-content: space-between; font-size: 0.75rem; color: #aaa; margin-bottom: 3px; align-items: center;">
                                    <span style="flex:1; padding-right:0.5rem; display: flex; align-items: center; gap: 0.5rem;">
                                        <input type="checkbox" class="profile-cb gme-cb" 
                                            data-days="${gmeData.total.mid}" 
                                            data-age="${gmeData.code.age_moyen}" 
                                            data-sexe="${gmeData.code.sexe_ratio}" 
                                            data-avqp="${gmeData.code.avq_physique}" 
                                            data-avqr="${gmeData.code.avq_relationnel}" 
                                            data-csarr="${gmeData.code.nb_actes_csarr}" 
                                            onclick="event.stopPropagation(); window.handleProfileToggle(this)">
                                        <span title="${displayGmeLabel}">${displayGmeLabel.length > 55 ? displayGmeLabel.substring(0, 55) + '...' : displayGmeLabel} ${gmeInfoHtml}</span>
                                    </span>
                                    <div style="text-align: right;">
                                        <span style="color: var(--text-light); font-weight: 500;">${formatStat(gmeData.total)}</span>
                                        ${detailsStr ? `<br><span style="font-size: 0.65rem; color: #888;">${detailsStr}</span>` : ''}
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

        document.getElementById('det-raw').innerHTML = breakdownHtml;
    } else {
        document.getElementById('det-raw').textContent = "Aucun historique disponible.";
        document.getElementById('det-metrics').innerHTML = "";
        document.getElementById('det-smr-metrics').innerHTML = "";
    }
}

export function updateChart(labels, dataArr, hcArr, hpArr) {
    const ctx = document.getElementById('detailChart').getContext('2d');

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

    $cm.select2({ placeholder: "Rechercher une CM...", width: '100%', allowClear: true });
    $gn.select2({ placeholder: "Rechercher un GN...", width: '100%', allowClear: true });
    $gme.select2({ placeholder: "Rechercher un GME...", width: '100%', allowClear: true });

    state.optionsTree.forEach(cm => {
        if (cm.value === 'ALL') return;
        $cm.append(new Option(`${cm.text}`, cm.value));
    });

    $cm.val(null);
    $cm.trigger('change.select2');

    $('#toggle-show-all').on('change', function () {
        showAllOptions = this.checked;
        rebuildAllOptions();
    });

    $('#btn-clear-filters').on('click', function () {
        clearActivityFilters();
    });

    $cm.on('change', async () => {
        let cmVals = $cm.val() || [];
        cmVals = Array.isArray(cmVals) ? cmVals.filter(v => v && v !== 'ALL') : (cmVals ? [cmVals] : []);

        $('#filter-gme').empty();
        $('#filter-gme').val(null).trigger('change.select2');

        rebuildAllOptions();
        await applyActivityFilter();
    });

    $gn.on('change', async () => {
        const cmVals = ($('#filter-cm').val() || []).filter(v => v && v !== 'ALL');
        const gnVals = ($('#filter-gn').val() || []).filter(Boolean);

        const $gme = $('#filter-gme');
        $gme.empty();
        const gmeSeen = new Set();

        if (gnVals.length > 0) {
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
            if (showAllOptions) {
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

    $gme.on('change', async () => {
        await applyActivityFilter();
    });
}

async function applyActivityFilter() {
    const rawCm = ($('#filter-cm').val() || []);
    const cm = Array.isArray(rawCm) ? rawCm.filter(v => v && v !== 'ALL') : (rawCm ? [rawCm] : []);
    const gn = ($('#filter-gn').val() || []).filter(v => v && v !== '');
    const gme = ($('#filter-gme').val() || []).filter(v => v && v !== '');

    const hasAnyMedicalFilter = (cm.length > 0) || (gn.length > 0) || (gme.length > 0);
    const allowGnOnly = !!window.showAllOptions;

    if (!hasAnyMedicalFilter && !allowGnOnly) {
        state.mapCustomData = null;
    } else {
        document.body.style.cursor = 'wait';
        const mapBtn = document.getElementById('btn-map');
        const originalText = mapBtn ? mapBtn.textContent : null;
        if (mapBtn) mapBtn.textContent = "Calcul en cours...";

        try {
            state.mapCustomData = await fetchMapActivityData(cm, gn, gme);
        } catch (err) {
            console.error('Erreur fetchMapActivityData', err);
            state.mapCustomData = null;
        } finally {
            document.body.style.cursor = 'default';
            if (mapBtn) mapBtn.textContent = originalText;
        }
    }

    if (state.table) {
        state.table.rows().invalidate('data');
        state.table.draw();
        updateGlobalStats();
    }

    if (state.currentView === 'map') {
        refreshViews();
    }
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

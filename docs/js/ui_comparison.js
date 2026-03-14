// js/ui_comparison.js
import { state, config } from './state.js';
import { fetchHistory } from './api.js';
import { parseDays, addStats, formatStat } from './ui_utils.js';
import { captureMedicalFilters } from './ui_medical_filters.js';

let comparisonChartInstance = null;
let comparisonProfileChartInstance = null;
let comparisonDiffChartInstance = null;
let comparisonRadarChartInstance = null;
let comparisonRadarMultiChartInstance = null;
let lastComparisonData = null;

/**
 * Closes the comparison view
 */
export function closeComparison() {
    document.getElementById('comparison-view').style.display = 'none';
    const refSelect = document.getElementById('comparison-reference');
    if (refSelect) refSelect.value = "";
}

/**
 * Opens the comparison view for selected establishments
 */
export async function openComparison() {
    const selected = state.selectedFiness;
    if (selected.length < 2) return;

    document.getElementById('comparison-view').style.display = 'block';
    const content = document.getElementById('comparison-indicators');
    content.innerHTML = '<div style="color: var(--text-muted); padding: 2rem;">Chargement des données comparatives...</div>';

    try {
        const dataPromises = selected.map(async (finess) => {
            const historyFiles = await fetchHistory(finess);
            const filePromises = historyFiles.map(file => fetch(config.cdnPrefix + file).then(r => r.json()));
            const allFilesData = await Promise.all(filePromises);

            let merged = {
                finess,
                raison_sociale: state.mapping[finess].reason_sociale || state.mapping[finess].raison_sociale,
                periodes: {}
            };
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

/**
 * Aggregates days for a given period with priority to official totals
 */
function sumEstData(periodData, filters, field) {
    let total = parseDays();

    // 1. Global level
    if (!filters.hasFilter) {
        const off = periodData.total || {};
        if (off[field] && off[field] !== "NA") return parseDays(off[field]);
    }

    // 2. Ladder Logic: CM -> GN -> GME
    Object.entries(periodData).forEach(([catMaj, gns]) => {
        if (catMaj === 'total') return;
        if (filters.selCms.length > 0 && !filters.selCms.includes(catMaj)) return;

        const cmOff = gns.total || {};
        const isCmFilteredDeeper = filters.selGns.some(id => gns[id]) || filters.selGmes.some(id => Object.values(gns).some(gn => gn[id]));

        if (!isCmFilteredDeeper && cmOff[field] && cmOff[field] !== "NA") {
            total = addStats(total, parseDays(cmOff[field]));
            return;
        }

        const hasGnFilterInThisCm = filters.selGns.some(id => gns[id]);
        Object.entries(gns || {}).forEach(([gnId, gmes]) => {
            if (gnId === 'total') return;
            if (hasGnFilterInThisCm && !filters.selGns.includes(gnId)) return;

            const gnOff = gmes.total || {};
            const hasGmeFilterInThisGn = filters.selGmes.some(id => gmes[id]);

            if (!hasGmeFilterInThisGn && gnOff[field] && gnOff[field] !== "NA") {
                total = addStats(total, parseDays(gnOff[field]));
                return;
            }

            // GME level
            Object.entries(gmes || {}).forEach(([gmeId, code]) => {
                if (gmeId === 'total') return;
                if (filters.selGmes.length > 0 && !filters.selGmes.includes(gmeId)) return;
                total = addStats(total, parseDays(code[field]));
            });
        });
    });
    return total;
}

/**
 * Renders the comparison content
 */
export function renderComparison(allData) {
    const filters = captureMedicalFilters();
    const isFiltered = filters?.hasFilter === true;

    const allLabels = [...new Set(allData.flatMap(d => Object.keys(d.periodes)))].sort();

    const chartDatasets = allData.map((d, idx) => {
        const colors = ['#a78bfa', '#34d399', '#f59e0b', '#38bdf8', '#f43f5e', '#fbbf24'];
        const color = colors[idx % colors.length];

        return {
            label: d.raison_sociale,
            data: allLabels.map(p => {
                const pData = d.periodes[p] || {};
                const hcS = sumEstData(pData, filters, 'nb_journees_hc');
                const hpS = sumEstData(pData, filters, 'nb_journees_hp');
                const total = hcS.mid + hpS.mid;
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

    document.getElementById('comparison-name').textContent = isFiltered ? `📉 Comparaison d'Établissements (Filtré)` : `Comparaison d'Établissements`;

    const duoCharts = document.getElementById('comparison-duo-charts');
    if (duoCharts) duoCharts.style.display = 'grid';

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

    const indicatorsContent = document.getElementById('comparison-indicators');
    let html = `
        <div style="grid-column: 1 / -1; display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem; margin-bottom: 2rem;">
    `;

    html = selectorHtml + html;

    allData.forEach(d => {
        const lastP = Object.keys(d.periodes).sort().pop();
        const pData = d.periodes[lastP] || {};
        const meta = state.mapping[d.finess];

        const hcStat = sumEstData(pData, filters, 'nb_journees_hc');
        const hpStat = sumEstData(pData, filters, 'nb_journees_hp');
        const totalStat = addStats(hcStat, hpStat);

        let age = "N/C", sexe = "N/C", avqp = "N/C", avqr = "N/C", csarr = "N/C";

        if (!isFiltered) {
            const off = pData.total || {};
            if (off.age_moyen && off.age_moyen !== "NA") age = parseFloat(off.age_moyen).toFixed(2);
            if (off.sexe_ratio && off.sexe_ratio !== "NA") sexe = parseFloat(off.sexe_ratio).toFixed(2);
            if (off.avq_physique && off.avq_physique !== "NA") avqp = parseFloat(off.avq_physique).toFixed(2);
            if (off.avq_relationnel && off.avq_relationnel !== "NA") avqr = parseFloat(off.avq_relationnel).toFixed(2);
            if (off.nb_actes_csarr && off.nb_actes_csarr !== "NA") csarr = parseFloat(off.nb_actes_csarr).toFixed(2);
        } else {
            // Aggregation for indicators
            let wSumAge = 0, dAge = 0, wSumSexe = 0, dSexe = 0, wSumAvqp = 0, dAvqp = 0, wSumAvqr = 0, dAvqr = 0, wSumCsarr = 0, dCsarr = 0;
            Object.entries(pData).forEach(([catMaj, gns]) => {
                if (catMaj === 'total') return;
                if (filters.selCms.length > 0 && !filters.selCms.includes(catMaj)) return;
                Object.entries(gns || {}).forEach(([gnId, gmes]) => {
                    if (filters.selGns.length > 0 && !filters.selGns.includes(gnId)) return;
                    Object.entries(gmes || {}).forEach(([gmeId, code]) => {
                        if (filters.selGmes.length > 0 && !filters.selGmes.includes(gmeId)) return;
                        const days = parseDays(code.nb_journees_hc).mid + parseDays(code.nb_journees_hp).mid;
                        if (days > 0) {
                            const vAge = parseFloat(code.age_moyen); if (!isNaN(vAge)) { wSumAge += vAge * days; dAge += days; }
                            const vSexe = parseFloat(code.sexe_ratio); if (!isNaN(vSexe)) { wSumSexe += vSexe * days; dSexe += days; }
                            const vAvqp = parseFloat(code.avq_physique); if (!isNaN(vAvqp)) { wSumAvqp += vAvqp * days; dAvqp += days; }
                            const vAvqr = parseFloat(code.avq_relationnel); if (!isNaN(vAvqr)) { wSumAvqr += vAvqr * days; dAvqr += days; }
                            const vCsarr = parseFloat(code.nb_actes_csarr); if (!isNaN(vCsarr)) { wSumCsarr += vCsarr * days; dCsarr += days; }
                        }
                    });
                });
            });
            if (dAge > 0) age = (wSumAge / dAge).toFixed(2);
            if (dSexe > 0) sexe = (wSumSexe / dSexe).toFixed(2);
            if (dAvqp > 0) avqp = (wSumAvqp / dAvqp).toFixed(2);
            if (dAvqr > 0) avqr = (wSumAvqr / dAvqr).toFixed(2);
            if (dCsarr > 0) csarr = (wSumCsarr / dCsarr).toFixed(2);
        }

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
                    <span style="font-weight: 600;">${age !== "N/C" ? age + " ans" : "N/C 🔒"}</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.4rem;">
                    <span style="font-size: 0.8rem; color: var(--text-muted);">Sexe Ratio</span>
                    <span style="font-weight: 600;">${sexe !== "N/C" ? sexe + "% H" : "N/C 🔒"}</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.4rem;">
                    <span style="font-size: 0.8rem; color: var(--text-muted);">AVQ physique</span>
                    <span style="font-weight: 600;">${avqp !== "N/C" ? avqp + "/4" : "N/C 🔒"}</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.4rem;">
                    <span style="font-size: 0.8rem; color: var(--text-muted);">AVQ relationnel</span>
                    <span style="font-weight: 600;">${avqr !== "N/C" ? avqr + "/4" : "N/C 🔒"}</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.4rem;">
                    <span style="font-size: 0.8rem; color: var(--text-muted);">Actes CSARR</span>
                    <span style="font-weight: 600;">${csarr !== "N/C" ? csarr + "/j" : "N/C 🔒"}</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-top: 0.8rem; padding-top: 0.8rem; border-top: 1px solid rgba(255,255,255,0.05);">
                    <span style="font-size: 0.8rem; color: var(--text-muted);">Activité</span>
                    <span style="font-weight: 600; color: var(--primary-light);">${formatStat(totalStat)}</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-top: 0.3rem;">
                    <span style="font-size: 0.75rem; color: var(--text-muted);">HC</span>
                    <span style="font-weight: 600; color: var(--primary-light);">${formatStat(hcStat)}</span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <span style="font-size: 0.75rem; color: var(--text-muted);">HP</span>
                    <span style="font-weight: 600; color: var(--primary-light);">${formatStat(hpStat)}</span>
                </div>
            </div>
        `;
    });

    html += `</div>`;
    indicatorsContent.innerHTML = html;

    renderMultiRadar(allData);

    initComparisonTabs();
    const refSelect = document.getElementById('comparison-reference');

    refSelect.onchange = () => {
        if (!refSelect.value) {
            document.getElementById('comparison-tabs').style.display = 'none';
            return;
        }
        computeComparisonProfile(allData);
    };

    if (allData.length === 2) {
        refSelect.value = String(allData[0].finess);
        computeComparisonProfile(allData);
    }

    if (!refSelect.value) {
        document.getElementById('comparison-tabs').style.display = 'none';
    }
}

function computeProfile(est, filters) {
    const lastP = Object.keys(est.periodes).sort().pop();
    const pData = est.periodes[lastP] || {};

    if (!filters.hasFilter) {
        const off = pData.total || {};
        return {
            age: off.age_moyen && off.age_moyen !== "NA" ? parseFloat(off.age_moyen) : null,
            sexe: off.sexe_ratio && off.sexe_ratio !== "NA" ? parseFloat(off.sexe_ratio) : null,
            avqp: off.avq_physique && off.avq_physique !== "NA" ? parseFloat(off.avq_physique) : null,
            avqr: off.avq_relationnel && off.avq_relationnel !== "NA" ? parseFloat(off.avq_relationnel) : null,
            csarr: off.nb_actes_csarr && off.nb_actes_csarr !== "NA" ? parseFloat(off.nb_actes_csarr) : null
        };
    }

    let wAge = 0, dAge = 0, wSexe = 0, dSexe = 0, wAvqp = 0, dAvqp = 0, wAvqr = 0, dAvqr = 0, wCsarr = 0, dCsarr = 0;
    Object.entries(pData).forEach(([catMaj, gns]) => {
        if (catMaj === 'total') return;
        if (filters.selCms.length > 0 && !filters.selCms.includes(catMaj)) return;
        Object.entries(gns || {}).forEach(([gnId, gmes]) => {
            if (filters.selGns.length > 0 && !filters.selGns.includes(gnId)) return;
            Object.entries(gmes || {}).forEach(([gmeId, code]) => {
                if (filters.selGmes.length > 0 && !filters.selGmes.includes(gmeId)) return;
                const days = parseDays(code.nb_journees_hc).mid + parseDays(code.nb_journees_hp).mid;
                if (days > 0) {
                    const vAge = parseFloat(code.age_moyen); if (!isNaN(vAge)) { wAge += vAge * days; dAge += days; }
                    const vSexe = parseFloat(code.sexe_ratio); if (!isNaN(vSexe)) { wSexe += vSexe * days; dSexe += days; }
                    const vAvqp = parseFloat(code.avq_physique); if (!isNaN(vAvqp)) { wAvqp += vAvqp * days; dAvqp += days; }
                    const vAvqr = parseFloat(code.avq_relationnel); if (!isNaN(vAvqr)) { wAvqr += vAvqr * days; dAvqr += days; }
                    const vCsarr = parseFloat(code.nb_actes_csarr); if (!isNaN(vCsarr)) { wCsarr += vCsarr * days; dCsarr += days; }
                }
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

function computeComparisonProfile(allData) {
    const refFiness = document.getElementById('comparison-reference').value;
    if (!refFiness) {
        document.getElementById('comparison-tabs').style.display = 'none';
        const duoProfiles = document.getElementById('comparison-duo-profiles');
        if (duoProfiles) duoProfiles.style.display = 'none';
        return;
    }
    document.getElementById('comparison-tabs').style.display = 'block';
    const duoProfiles = document.getElementById('comparison-duo-profiles');
    if (duoProfiles) duoProfiles.style.display = 'grid';

    const filters = captureMedicalFilters();
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
                tooltip: { callbacks: { label: ctx => `${ctx.raw.toFixed(2)}%` } }
            },
            scales: {
                y: { grid: { color: 'rgba(255,255,255,0.05)' } },
                x: { grid: { display: false } }
            }
        }
    });
}

function computeComparisonRadar(refProfile, avgProfile, refName) {
    const labels = ['Âge', 'Sexe (%H)', 'AVQ Physique', 'AVQ Relationnel', 'CSARR'];

    // 1. Les vraies valeurs brutes
    const refRaw = [refProfile.age, refProfile.sexe, refProfile.avqp, refProfile.avqr, refProfile.csarr];
    const avgRaw = [avgProfile.age, avgProfile.sexe, avgProfile.avqp, avgProfile.avqr, avgProfile.csarr];

    // 2. Les plafonds réels pour équilibrer le graphique (Age:100, Sexe:100, AVQ:16, CSARR:5)
    const maxes = [100, 100, 16, 16, 5];

    // 3. Normalisation de 0 à 100% pour que le dessin soit proportionné
    const refNormalized = refRaw.map((v, i) => v !== null && !isNaN(v) ? (v / maxes[i]) * 100 : null);
    const avgNormalized = avgRaw.map((v, i) => v !== null && !isNaN(v) ? (v / maxes[i]) * 100 : null);

    const ctx = document.getElementById('comparisonRadarChart').getContext('2d');
    if (comparisonRadarChartInstance) comparisonRadarChartInstance.destroy();

    comparisonRadarChartInstance = new Chart(ctx, {
        type: 'radar',
        data: {
            labels,
            datasets: [
                {
                    label: refName,
                    data: refNormalized, // On donne les pourcentages au radar
                    rawValues: refRaw,   // On stocke les vraies valeurs pour l'infobulle
                    backgroundColor: 'rgba(56, 189, 248, 0.3)',
                    borderColor: '#38bdf8',
                    borderWidth: 2,
                    pointRadius: 3
                },
                {
                    label: 'Moyenne Autres',
                    data: avgNormalized, // On donne les pourcentages au radar
                    rawValues: avgRaw,   // On stocke les vraies valeurs pour l'infobulle
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
                    min: 0,
                    max: 100, // On verrouille le cadre extérieur
                    ticks: { display: false },
                    grid: { color: 'rgba(255,255,255,0.1)' },
                    angleLines: { color: 'rgba(255,255,255,0.1)' },
                    pointLabels: { color: '#cbd5e1' }
                }
            },
            plugins: {
                // 4. On modifie l'infobulle au survol pour afficher la vraie valeur
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const val = context.dataset.rawValues[context.dataIndex];
                            if (val === null || val === undefined || isNaN(val)) return `${context.dataset.label} : N/C`;
                            return `${context.dataset.label} : ${val.toFixed(2)}`;
                        }
                    }
                }
            }
        }
    });
}

export function renderMultiRadar(allData) {
    const filters = window.currentMedicalFilters || { selCms: [], selGns: [], selGmes: [], hasFilter: false };
    const profiles = allData.map(est => ({
        name: est.raison_sociale,
        profile: computeProfile(est, filters)
    }));

    const labels = ['Âge (ans)', 'Sexe Ratio (%H)', 'AVQ Physique', 'AVQ Relationnel', 'CSARR (/j)'];
    const maxes = [100, 100, 16, 16, 5]; // Mêmes plafonds

    const datasets = profiles.map((p, idx) => {
        const colors = ['#38bdf8', '#a78bfa', '#34d399', '#f59e0b', '#f43f5e', '#fbbf24'];
        const color = colors[idx % colors.length];

        const rawValues = [p.profile.age, p.profile.sexe, p.profile.avqp, p.profile.avqr, p.profile.csarr];
        const normValues = rawValues.map((v, i) => v !== null && !isNaN(v) ? (v / maxes[i]) * 100 : null);

        return {
            label: p.name,
            data: normValues,     // Pourcentages
            rawValues: rawValues, // Vraies valeurs
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
                    min: 0,
                    max: 100,
                    ticks: { display: false },
                    grid: { color: 'rgba(255,255,255,0.1)' },
                    angleLines: { color: 'rgba(255,255,255,0.1)' },
                    pointLabels: { color: '#cbd5e1' }
                }
            },
            plugins: {
                legend: { position: 'bottom' },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const val = context.dataset.rawValues[context.dataIndex];
                            if (val === null || val === undefined || isNaN(val)) return `${context.dataset.label} : N/C`;
                            return `${context.dataset.label} : ${val.toFixed(2)}`;
                        }
                    }
                }
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

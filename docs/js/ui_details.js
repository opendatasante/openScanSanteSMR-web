// js/ui_details.js
import { state, config } from './state.js';
import { fetchHistory } from './api.js';
import { parseDays, addStats, formatStat } from './ui_utils.js';
import { captureMedicalFilters } from './ui_medical_filters.js';

let mainChartInstance = null;
let profilingChartInstance = null;
let indicatorTrendChartInstance = null;
const isTotal = (k) => k && String(k).trim().toLowerCase() === 'total';

/**
 * Helper to get official data for a given filter scope in a period
 */
function getOfficialData(periodData, filters = null) {
    if (!periodData) return {};
    if (!filters || !filters.hasFilter) return periodData.total || {};

    if (filters.selCms.length === 1 && filters.selGns.length === 0 && filters.selGmes.length === 0) {
        return periodData[filters.selCms[0]]?.total || {};
    }

    if (filters.selGns.length === 1 && filters.selGmes.length === 0) {
        for (const catMaj in periodData) {
            if (isTotal(catMaj)) continue;
            if (periodData[catMaj][filters.selGns[0]]) {
                return periodData[catMaj][filters.selGns[0]].total || {};
            }
        }
    }
    return {};
}

/**
 * Loads and displays an establishment's details
 */
export async function loadEstablishment(finess) {
    if (!finess) return;

    document.getElementById('detail-view').style.display = 'block';
    document.getElementById('detail-content').style.display = 'none';
    document.getElementById('detail-loader').style.display = 'block';

    try {
        const historyFiles = await fetchHistory(finess);
        const filePromises = historyFiles.map(file => fetch(config.cdnPrefix + file).then(r => r.json()));
        const allFilesData = await Promise.all(filePromises);

        let merged = { finess, info: state.mapping[finess], periodes: {}, sources: historyFiles, raison_sociale: state.mapping[finess].reason_sociale || state.mapping[finess].raison_sociale };
        allFilesData.forEach(fileData => {
            if (fileData.periodes) {
                Object.entries(fileData.periodes).forEach(([p, data]) => {
                    merged.periodes[p] = data;
                });
            }
            if (fileData.site_updated_at) merged.site_updated_at = fileData.site_updated_at;
        });

        renderDetails(merged);

        document.getElementById('detail-loader').style.display = 'none';
        document.getElementById('detail-content').style.display = 'block';
    } catch (err) {
        console.error("Detail Error:", err);
        document.getElementById('det-name').textContent = "Erreur de chargement";
        document.getElementById('detail-loader').style.display = 'none';
    }
}

/**
 * Renders the detail view content
 */
export function renderDetails(data) {
    const periodes = Object.keys(data.periodes || {}).sort();
    const filters = captureMedicalFilters();

    document.getElementById('indicator-trend-section').style.display = 'none';
    document.getElementById('profiling-section').style.display = 'none';
    document.querySelectorAll('.profile-cb').forEach(cb => { cb.checked = false; cb.indeterminate = false; });

    document.getElementById('det-meta-top').innerHTML = `
    <div class="det-meta-row">
        <span class="badge">FINESS ${data.finess}</span>
        <span class="badge badge--highlight">${data.info?.categorie || 'N/A'}</span>
        <span class="badge badge--muted">MàJ ${data.site_updated_at || 'N/A'}</span>
        <span class="badge badge--history">Historique : ${data.sources?.length || 0} fichiers</span>
    </div>

    <div class="det-meta-row det-meta-info">
        <div class="info-item full">
            <span class="info-label">Catégorie d'établissement</span>
            <span class="info-value">${data.info?.libcategetab || 'Catégorie inconnue'}</span>
        </div>

        <div class="info-item full">
            <span class="info-label">Adresse</span>
            <span class="info-value">${data.info?.adresse || 'Adresse inconnue'}</span>
        </div>

        <div class="info-item">
            <span class="info-label">Commune</span>
            <span class="info-value">${data.info?.com_name || 'N/A'}</span>
        </div>

        <div class="info-item">
            <span class="info-label">EPCI</span>
            <span class="info-value">${data.info?.epci_name || 'N/A'}</span>
        </div>

        <div class="info-item full">
            <span class="info-label">Téléphone</span>
            <span class="info-value">${data.info?.telephone || 'Téléphone inconnu'}</span>
        </div>

        <div class="info-item full">
            <span class="info-label">Localisation</span>
            <span class="info-value">${data.info?.latitude + ',' + data.info?.longitude || 'N/A'}</span>
        </div>

        <div class="info-item">
            <span class="info-label">Date ouverture</span>
            <span class="info-value">${data.info?.dateouv || 'N/A'}</span>
        </div>

        <div class="info-item">
            <span class="info-label">Date autorisation</span>
            <span class="info-value">${data.info?.dateautor || 'N/A'}</span>
        </div>
    </div>

    <div class="det-meta-row">
        <div class="badge-row">
            <span class="badge">EJ ${data.info?.nofinessej || 'N/A'}</span>
            <span class="badge badge--highlight">SIRET ${data.info?.siret || 'N/A'}</span>
            <span class="badge badge--muted">APE ${data.info?.codeape || 'N/A'}</span>
        </div>

        <div class="badge-row">
            <span class="badge badge--history">SPH : ${data.info?.libsph || 'N/A'}</span>
            <span class="badge badge--history">Mode de financement : ${data.info?.libmft || 'N/A'}</span>
        </div>
    </div>`;


    const baseTitle = data.raison_sociale || "Établissement inconnu";
    const isFiltered = filters?.hasFilter === true;
    document.getElementById('det-name').textContent = isFiltered ? `📉 ${baseTitle} (Filtré)` : baseTitle;

    if (periodes.length > 0) {
        const labels = periodes;
        const sumForPeriod = (p, field) => {
            const periodData = data.periodes[p] || {};

            // 1. Global level
            if (!filters.hasFilter) {
                const off = periodData.total || {};
                if (off[field] && off[field] !== "NA") return parseDays(off[field]);
            }

            let total = { min: 0, max: 0, isExact: true, mid: 0 };
            Object.entries(periodData).forEach(([catMaj, gns]) => {
                if (isTotal(catMaj)) return;
                if (filters.selCms.length > 0 && !filters.selCms.includes(catMaj)) return;

                // 2. CM level: Use official if no deep filters in THIS CM
                const cmOff = gns.total || {};
                const isCmFilteredDeeper = filters.selGns.some(id => gns[id]) || filters.selGmes.some(id => Object.values(gns).some(gn => gn[id]));

                if (!isCmFilteredDeeper && cmOff[field] && cmOff[field] !== "NA") {
                    total = addStats(total, parseDays(cmOff[field]));
                    return;
                }

                const hasGnFilterInThisCm = filters.selGns.some(id => gns[id]);

                Object.entries(gns || {}).forEach(([gnId, gmes]) => {
                    if (isTotal(gnId)) return;
                    if (hasGnFilterInThisCm && !filters.selGns.includes(gnId)) return;

                    // 3. GN level: Use official if no GME filter in THIS GN
                    const gnOff = gmes.total || {};
                    const hasGmeFilterInThisGn = filters.selGmes.some(id => gmes[id]);

                    if (!hasGmeFilterInThisGn && gnOff[field] && gnOff[field] !== "NA") {
                        total = addStats(total, parseDays(gnOff[field]));
                        return;
                    }

                    Object.entries(gmes || {}).forEach(([gmeId, code]) => {
                        if (isTotal(gmeId)) return;
                        if (hasGmeFilterInThisGn && !filters.selGmes.includes(gmeId)) return;
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

        updateChart(
            labels,
            valuesStat.map(v => v.mid),
            hcValuesStat.map(v => v.mid),
            hpValuesStat.map(v => v.mid)
        );

        const lastP = periodes[periodes.length - 1];
        const lastPData = data.periodes[lastP] || {};
        const hcStat = hcValuesStat[hcValuesStat.length - 1];
        const hpStat = hpValuesStat[hpValuesStat.length - 1];

        const fullBreakdown = {};

        let totalDaysForAge = 0, weightedSumAge = 0;
        let totalDaysForSexe = 0, weightedSumSexe = 0;
        let totalDaysForAVQP = 0, weightedSumAVQP = 0;
        let totalDaysForAVQR = 0, weightedSumAVQR = 0;
        let totalStaysForCSARR = 0, weightedSumCSARR = 0;

        // Helper to update the breakdown object for a specific node (CM or GN)
        const populateNodeInd = (node, obj, d) => {
            const age = parseFloat(obj.age_moyen);
            if (!isNaN(age)) { node.wAge += age * d; node.dAge += d; }
            const sexe = parseFloat(obj.sexe_ratio);
            if (!isNaN(sexe)) { node.wSexe += sexe * d; node.dSexe += d; }
            const avqp = parseFloat(obj.avq_physique);
            if (!isNaN(avqp)) { node.wAvqp += avqp * d; node.dAvqp += d; }
            const avqr = parseFloat(obj.avq_relationnel);
            if (!isNaN(avqr)) { node.wAvqr += avqr * d; node.dAvqr += d; }
            const csarr = parseFloat(obj.nb_actes_csarr);
            if (!isNaN(csarr)) { node.wCsarr += csarr * d; node.sCsarr += d; }
        };

        // Helper to update global application-wide totals
        const addToGlobalInd = (obj, d) => {
            const age = parseFloat(obj.age_moyen);
            if (!isNaN(age)) { weightedSumAge += age * d; totalDaysForAge += d; }
            const sexe = parseFloat(obj.sexe_ratio);
            if (!isNaN(sexe)) { weightedSumSexe += sexe * d; totalDaysForSexe += d; }
            const avqp = parseFloat(obj.avq_physique);
            if (!isNaN(avqp)) { weightedSumAVQP += avqp * d; totalDaysForAVQP += d; }
            const avqr = parseFloat(obj.avq_relationnel);
            if (!isNaN(avqr)) { weightedSumAVQR += avqr * d; totalDaysForAVQR += d; }
            const csarr = parseFloat(obj.nb_actes_csarr);
            if (!isNaN(csarr)) { weightedSumCSARR += csarr * d; totalStaysForCSARR += d; }
        };

        Object.entries(lastPData).forEach(([catMaj, gns]) => {
            if (isTotal(catMaj)) return;
            if (filters.selCms.length > 0 && !filters.selCms.includes(catMaj)) return;

            const cmOff = gns.total || {};
            const isCmFilteredDeeper = filters.selGns.some(id => gns[id]) || filters.selGmes.some(id => Object.values(gns).some(gn => gn[id]));

            // 1. CM level: Use official if no sub-filters in THIS branch
            let cmTotal = (cmOff.nb_journees_total && cmOff.nb_journees_total !== "NA" && !isCmFilteredDeeper)
                ? parseDays(cmOff.nb_journees_total)
                : { min: 0, max: 0, isExact: true, mid: 0 };

            fullBreakdown[catMaj] = { total: cmTotal, gns: {}, wAge: 0, dAge: 0, wSexe: 0, dSexe: 0, wAvqp: 0, dAvqp: 0, wAvqr: 0, dAvqr: 0, wCsarr: 0, sCsarr: 0 };

            let cmDoneInd = false;
            if (!isCmFilteredDeeper && cmOff.age_moyen && cmOff.age_moyen !== "NA") {
                populateNodeInd(fullBreakdown[catMaj], cmOff, cmTotal.mid);
                addToGlobalInd(cmOff, cmTotal.mid);
                cmDoneInd = true;
            }

            const hasGnFilterInThisCm = filters.selGns.some(id => gns[id]);

            Object.entries(gns || {}).forEach(([gnId, gmes]) => {
                if (isTotal(gnId)) return;
                if (hasGnFilterInThisCm && !filters.selGns.includes(gnId)) return;

                const gnOff = gmes.total || {};
                const hasGmeFilterInThisGn = filters.selGmes.some(id => gmes[id]);
                const isGnFilteredDeeper = hasGmeFilterInThisGn;

                // 2. GN level: Use official if no GME filter in THIS GN
                let gnTotal = (gnOff.nb_journees_total && gnOff.nb_journees_total !== "NA" && !isGnFilteredDeeper)
                    ? parseDays(gnOff.nb_journees_total)
                    : { min: 0, max: 0, isExact: true, mid: 0 };

                fullBreakdown[catMaj].gns[gnId] = { total: gnTotal, gmes: {}, wAge: 0, dAge: 0, wSexe: 0, dSexe: 0, wAvqp: 0, dAvqp: 0, wAvqr: 0, dAvqr: 0, wCsarr: 0, sCsarr: 0 };

                let gnDoneInd = false;
                if (!isGnFilteredDeeper && gnOff.age_moyen && gnOff.age_moyen !== "NA") {
                    populateNodeInd(fullBreakdown[catMaj].gns[gnId], gnOff, gnTotal.mid);
                    if (!cmDoneInd) {
                        populateNodeInd(fullBreakdown[catMaj], gnOff, gnTotal.mid);
                        addToGlobalInd(gnOff, gnTotal.mid);
                    }
                    gnDoneInd = true;
                }

                // If GN level is partial, we MUST aggregate GMEs to get gnTotal
                if (isGnFilteredDeeper || !gnOff.nb_journees_total || gnOff.nb_journees_total === "NA") {
                    Object.entries(gmes || {}).forEach(([gmeId, code]) => {
                        if (isTotal(gmeId)) return;
                        if (hasGmeFilterInThisGn && !filters.selGmes.includes(gmeId)) return;

                        const c_hc = parseDays(code.nb_journees_hc);
                        const c_hp = parseDays(code.nb_journees_hp);
                        const daysStat = addStats(c_hc, c_hp);

                        if (daysStat.max > 0) {
                            fullBreakdown[catMaj].gns[gnId].total = addStats(fullBreakdown[catMaj].gns[gnId].total, daysStat);
                            fullBreakdown[catMaj].gns[gnId].gmes[gmeId] = { total: daysStat, code: code, hc: c_hc, hp: c_hp };

                            // Even if gnDoneInd is true (which shouldn't happen here due to the IF above),
                            // we sum GMEs for indicators if parent levels aren't already covered by official data
                            if (!cmDoneInd && !gnDoneInd) {
                                populateNodeInd(fullBreakdown[catMaj].gns[gnId], code, daysStat.mid);
                                populateNodeInd(fullBreakdown[catMaj], code, daysStat.mid);
                                addToGlobalInd(code, daysStat.mid);
                            } else if (cmDoneInd && !gnDoneInd) {
                                // CM official data already used for global, but GN still needs its sum
                                populateNodeInd(fullBreakdown[catMaj].gns[gnId], code, daysStat.mid);
                            }
                        }
                    });
                } else {
                    // GN level is official/complete, still loop for GME metadata but don't add to gnTotal
                    Object.entries(gmes || {}).forEach(([gmeId, code]) => {
                        if (isTotal(gmeId)) return;
                        if (hasGmeFilterInThisGn && !filters.selGmes.includes(gmeId)) return;
                        const c_hc = parseDays(code.nb_journees_hc);
                        const c_hp = parseDays(code.nb_journees_hp);
                        const daysStat = addStats(c_hc, c_hp);
                        if (daysStat.max > 0) {
                            fullBreakdown[catMaj].gns[gnId].gmes[gmeId] = { total: daysStat, code: code, hc: c_hc, hp: c_hp };
                        }
                    });
                }

                // Finally, add the resolved gnTotal to cmTotal if CM is partial
                if (isCmFilteredDeeper) {
                    fullBreakdown[catMaj].total = addStats(fullBreakdown[catMaj].total, fullBreakdown[catMaj].gns[gnId].total);
                }

                if (fullBreakdown[catMaj].gns[gnId].total.max === 0) delete fullBreakdown[catMaj].gns[gnId];
            });
            if (fullBreakdown[catMaj].total.max === 0) delete fullBreakdown[catMaj];
        });

        const official = getOfficialData(lastPData, filters);

        const getInd = (calc, offValue, fixed = 1) => {
            if (offValue !== undefined && offValue !== null && offValue !== "NA") return parseFloat(offValue).toFixed(fixed);
            if (calc && !calc.includes("N/C")) return calc;
            return "N/C 🔒";
        };

        const avgAge = getInd(totalDaysForAge > 0 ? (weightedSumAge / totalDaysForAge).toFixed(2) : "N/C 🔒", official.age_moyen, 2);
        const avgSexe = getInd(totalDaysForSexe > 0 ? (weightedSumSexe / totalDaysForSexe).toFixed(2) : "N/C 🔒", official.sexe_ratio, 2);
        const avgAVQP = getInd(totalDaysForAVQP > 0 ? (weightedSumAVQP / totalDaysForAVQP).toFixed(2) : "N/C 🔒", official.avq_physique, 2);
        const avgAVQR = getInd(totalDaysForAVQR > 0 ? (weightedSumAVQR / totalDaysForAVQR).toFixed(2) : "N/C 🔒", official.avq_relationnel, 2);
        const avgCSARR = getInd(totalStaysForCSARR > 0 ? (weightedSumCSARR / totalStaysForCSARR).toFixed(2) : "N/C 🔒", official.nb_actes_csarr, 2);

        window.globalMetrics = { avgAge, avgSexe, avgAVQP, avgAVQR, avgCSARR };

        const compareAvg = (calc, off, unit = "") => {
            const unitHtml = unit ? ` ${unit.trim()}` : '';
            const offValid = off !== undefined && off !== null && off !== "NA";
            if (calc.includes("N/C") && !offValid) return { text: `<span class="muted" title="Donnée couverte par le secret statistique">${calc}</span>`, match: true };
            if (calc.includes("N/C") && offValid) return { text: `${parseFloat(off).toFixed(2)}${unitHtml}`, match: true }; // .toFixed(unit.includes("/") ? 2 : 1)
            if (filters.hasFilter || !offValid) return { text: `${calc}${unitHtml}`, match: true };

            const offVal = parseFloat(off);
            const calcVal = parseFloat(calc);
            const precision = 2; // .toFixed(unit.includes("/") ? 2 : 1)
            const isMatch = !isNaN(offVal) && !isNaN(calcVal) && Math.abs(calcVal - offVal) < (precision === 2 ? 0.005 : 0.05);

            if (isMatch) return { text: `${calc}${unitHtml}`, match: true };
            return { text: `${calc}${unitHtml} <span style="font-size:0.8em; color:#666">(off. ${offVal.toFixed(precision)}${unitHtml})</span>`, match: false };
        };

        const totalResStat = addStats(hcStat, hpStat);
        const formatC = (stat, off, unit) => {
            const html = formatStat(stat, unit);
            if (filters.hasFilter || !off) return { text: html, match: true };

            // Equality check: only show off if different
            const offVal = parseFloat(off);
            if (stat.isExact && Math.abs(stat.mid - offVal) < 0.1) return { text: html, match: true };

            return { text: `${html} <span style="font-size:0.8em; color:#666">(off. ${offVal.toLocaleString()})</span>`, match: false };
        };

        const totalRes = formatC(totalResStat, official.nb_journees_total, "j.");
        const hcRes = formatC(hcStat, official.nb_journees_hc, "j.");
        const hpRes = formatC(hpStat, official.nb_journees_hp, "j.");

        document.getElementById('det-metrics').innerHTML = `
        <div class="metric-card" style="grid-column: 1 / -1;">
            <div class="metric-label">Total des Journées</div>
            <div class="metric-value">${totalRes.text}</div>
        </div>
        <div class="metric-card">
            <div class="metric-label">Hospitalisation Complète</div>
            <div class="metric-value">${hcRes.text}</div>
        </div>
        <div class="metric-card">
            <div class="metric-label">Hospitalisation Partielle</div>
            <div class="metric-value">${hpRes.text}</div>
        </div>
        `;

        document.getElementById('det-smr-metrics').innerHTML = `
        <div class="metric-card" style="cursor: pointer;" onclick="window.showIndicatorTrend('age_moyen', 'Âge Moyen', 'ans')">
            <div class="metric-label">Âge Moyen <span style="font-size:0.7em; color: var(--text-muted);">(évolution ▶)</span></div>
            <div class="metric-value">${compareAvg(avgAge, official.age_moyen, "ans").text}</div>
        </div>
        <div class="metric-card" style="cursor: pointer;" onclick="window.showIndicatorTrend('sexe_ratio', 'Sexe Ratio', '%H')">
            <div class="metric-label">Sexe Ratio <span style="font-size:0.7em; color: var(--text-muted);">(évolution ▶)</span></div>
            <div class="metric-value">${compareAvg(avgSexe, official.sexe_ratio, "% H").text}</div>
        </div>
        <div class="metric-card" style="cursor: pointer;" onclick="window.showIndicatorTrend('avq_physique', 'AVQ Physique', '/16')">
            <div class="metric-label">AVQ Physique <span style="font-size:0.7em; color: var(--text-muted);">(évolution ▶)</span></div>
            <div class="metric-value">${compareAvg(avgAVQP, official.avq_physique, "/16").text}</div>
        </div>
        <div class="metric-card" style="cursor: pointer;" onclick="window.showIndicatorTrend('avq_relationnel', 'AVQ Relationnel', '/16')">
            <div class="metric-label">AVQ Relationnel <span style="font-size:0.7em; color: var(--text-muted);">(évolution ▶)</span></div>
            <div class="metric-value">${compareAvg(avgAVQR, official.avq_relationnel, "/16").text}</div>
        </div>
        <div class="metric-card" style="cursor: pointer;" onclick="window.showIndicatorTrend('nb_actes_csarr', 'Actes CSARR', '/j.')">
            <div class="metric-label">Actes CSARR <span style="font-size:0.7em; color: var(--text-muted);">(évolution ▶)</span></div>
            <div class="metric-value">${compareAvg(avgCSARR, official.nb_actes_csarr, "/j.").text}</div>
        </div>
        `;

        const buildInfoTooltip = (title, age, sexe, avqp, avqr, csarr) => {
            let parts = [];
            if (age && !isNaN(parseFloat(age))) parts.push(`Âge moyen: ${parseFloat(age).toFixed(2)} ans`);
            if (sexe && !isNaN(parseFloat(sexe))) parts.push(`Sexe Ratio: ${parseFloat(sexe).toFixed(2)}% H`);
            if (avqp && !isNaN(parseFloat(avqp))) parts.push(`AVQ Physique: ${parseFloat(avqp).toFixed(2)} /16`);
            if (avqr && !isNaN(parseFloat(avqr))) parts.push(`AVQ Relationnel: ${parseFloat(avqr).toFixed(2)} /16`);
            if (csarr && !isNaN(parseFloat(csarr))) parts.push(`Actes CSARR: ${parseFloat(csarr).toFixed(2)} /j.`);
            if (parts.length === 0) return '';
            return `<span title="Indicateurs pour '${title.replace(/"/g, '&quot;')}':&#10;${parts.join('&#10;')}" style="cursor:help; font-size: 0.9em; vertical-align: middle; filter: grayscale(1); opacity: 0.6; margin-left: 0.3rem;">ℹ️</span>`;
        };

        let breakdownHtml = '';
        const sortedCMs = Object.entries(fullBreakdown).sort((a, b) => b[1].total.mid - a[1].total.mid);
        sortedCMs.forEach(([cmId, cmData]) => {
            const cmLabelRaw = state.catMajLabels[cmId] || cmId;
            const cmLabel = cmLabelRaw.startsWith(cmId) ? cmLabelRaw : `${cmId} - ${cmLabelRaw}`;

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
                            <input type="checkbox" class="profile-cb cm-cb"
                                data-age="${cAge || ''}" data-sexe="${cSexe || ''}" data-avqp="${cAvqp || ''}" data-avqr="${cAvqr || ''}" data-csarr="${cCsarr || ''}"
                                data-days="${cmData.total.mid}"
                                onclick="event.stopPropagation(); window.handleProfileToggle(this)">
                            <span>▶ ${cmLabel} ${infoHtml}</span>
                        </span>
                        <span style="color: var(--primary-light); white-space: nowrap;">${formatStat(cmData.total)}</span>
                    </summary>
                    <div style="padding-left: 0.5rem; margin-top: 0.5rem; border-left: 2px solid rgba(255,255,255,0.1);">
            `;

            Object.entries(cmData.gns).sort((a, b) => b[1].total.mid - a[1].total.mid).forEach(([gnId, gnData]) => {
                const gnLabelRaw = state.gnLabels[gnId] || gnId;
                const gnLabel = gnLabelRaw.startsWith(gnId) ? gnLabelRaw : `${gnId} - ${gnLabelRaw}`;
                const hasGmeList = Object.keys(gnData.gmes).length > 0;
                const isExpandable = hasGmeList;

                const gAge = gnData.dAge > 0 ? gnData.wAge / gnData.dAge : null;
                const gSexe = gnData.dSexe > 0 ? gnData.wSexe / gnData.dSexe : null;
                const gAvqp = gnData.dAvqp > 0 ? gnData.wAvqp / gnData.dAvqp : null;
                const gAvqr = gnData.dAvqr > 0 ? gnData.wAvqr / gnData.dAvqr : null;
                const gCsarr = gnData.sCsarr > 0 ? gnData.wCsarr / gnData.sCsarr : null;
                const gnInfoHtml = buildInfoTooltip(gnLabel, gAge, gSexe, gAvqp, gAvqr, gCsarr);

                breakdownHtml += `
                    <details style="margin-bottom: 0.4rem; background: rgba(255,255,255,0.02); padding: 0.3rem; border-radius: 4px;">
                        <summary style="cursor: pointer; font-size: 0.8rem; display: flex; justify-content: space-between; color: #ccc; align-items: center; outline: none; list-style: none;">
                            <span style="flex:1; padding-right:1rem; display: flex; align-items: center; gap: 0.5rem;">
                                <input type="checkbox" class="profile-cb gn-cb"
                                    data-age="${gAge || ''}" data-sexe="${gSexe || ''}" data-avqp="${gAvqp || ''}" data-avqr="${gAvqr || ''}" data-csarr="${gCsarr || ''}"
                                    data-days="${gnData.total.mid}"
                                    onclick="event.stopPropagation(); window.handleProfileToggle(this)">
                                <span title="${gnLabel}">${isExpandable ? '▶ ' : '• '}${gnLabel.length > 50 ? gnLabel.substring(0, 50) + '...' : gnLabel} ${gnInfoHtml}</span>
                            </span>
                            <span style="white-space: nowrap;">${formatStat(gnData.total)}</span>
                        </summary>
                        <div style="padding-left: 1rem; margin-top: 0.4rem;">
                `;

                Object.entries(gnData.gmes).sort((a, b) => b[1].total.mid - a[1].total.mid).forEach(([gmeId, gmeData]) => {
                    const gmeLabelRaw = state.gmeLabels[gmeId] || gmeId;
                    const gmeLabel = gmeLabelRaw.startsWith(gmeId) ? gmeLabelRaw : `${gmeId} - ${gmeLabelRaw}`;

                    const hcStr = gmeData.hc.max > 0 ? `${formatStat(gmeData.hc, 'HC')}` : '';
                    const hpStr = gmeData.hp.max > 0 ? `${formatStat(gmeData.hp, 'HP')}` : '';
                    const detailsStr = [hcStr, hpStr].filter(Boolean).join(' <span style="color:#666">/</span> ');

                    const gmeInfoHtml = buildInfoTooltip(gmeLabel, gmeData.code.age_moyen, gmeData.code.sexe_ratio, gmeData.code.avq_physique, gmeData.code.avq_relationnel, gmeData.code.nb_actes_csarr);

                    breakdownHtml += `
                        <div class="gme-item" style="display: flex; justify-content: space-between; font-size: 0.75rem; color: #aaa; margin-bottom: 3px; align-items: center;">
                            <span style="flex:1; padding-right:0.5rem; display: flex; align-items: center; gap: 0.5rem;">
                                <input type="checkbox" class="profile-cb gme-cb" 
                                    data-days="${gmeData.total.mid}" data-age="${gmeData.code.age_moyen}" data-sexe="${gmeData.code.sexe_ratio}" 
                                    data-avqp="${gmeData.code.avq_physique}" data-avqr="${gmeData.code.avq_relationnel}" data-csarr="${gmeData.code.nb_actes_csarr}" 
                                    onclick="event.stopPropagation(); window.handleProfileToggle(this)">
                                <span title="${gmeLabel}">${gmeLabel.length > 55 ? gmeLabel.substring(0, 55) + '...' : gmeLabel} ${gmeInfoHtml}</span>
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
        document.getElementById('det-raw').innerHTML = breakdownHtml;
    }
}

/**
 * Updates the history line chart
 */
export function updateChart(labels, dataArr, hcArr, hpArr) {
    const ctx = document.getElementById('detailChart').getContext('2d');
    if (mainChartInstance) mainChartInstance.destroy();

    mainChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                { label: 'Total', data: dataArr, borderColor: '#a78bfa', backgroundColor: 'rgba(139, 92, 246, 0.1)', fill: true, tension: 0.3 },
                { label: 'HC', data: hcArr, borderColor: '#34d399', borderDash: [4, 4], fill: false, tension: 0.3 },
                { label: 'HP', data: hpArr, borderColor: '#f59e0b', borderDash: [4, 4], fill: false, tension: 0.3 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: '#94a3b8',
                        boxWidth: window.innerWidth < 768 ? 8 : 12,
                        font: { size: window.innerWidth < 768 ? 9 : 11 }
                    }
                }
            },
            scales: {
                y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', font: { size: window.innerWidth < 768 ? 9 : 11 } } },
                x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: window.innerWidth < 768 ? 9 : 11 } } }
            }
        }
    });
}

/**
 * Shows the trend for a specific indicator
 */
window.showIndicatorTrend = function (field, label, unit) {
    const pd = window.allPeriodes;
    if (!pd) return;

    const section = document.getElementById('indicator-trend-section');
    document.getElementById('indicator-trend-title').textContent = `Évolution de l'indicateur ${label} (${unit})`;
    section.style.display = 'block';

    const filters = window.currentMedicalFilters || { selCms: [], selGns: [], selGmes: [], hasFilter: false };
    const seriesData = pd.labels.map(p => {
        let wSum = 0, wDays = 0;
        Object.entries(pd.rawData[p] || {}).forEach(([catMaj, gns]) => {
            if (isTotal(catMaj) || (filters.selCms.length > 0 && !filters.selCms.includes(catMaj))) return;
            Object.entries(gns || {}).forEach(([gnId, gmes]) => {
                if (isTotal(gnId)) return; // Skip CM aggregate
                if (filters.selGns.length > 0 && !filters.selGns.includes(gnId)) return;
                Object.entries(gmes || {}).forEach(([gmeId, code]) => {
                    if (isTotal(gmeId)) return; // Skip GN aggregate
                    if (filters.selGmes.length > 0 && !filters.selGmes.includes(gmeId)) return;
                    const val = parseFloat(code[field]);
                    const days = parseDays(code.nb_journees_hc).mid + parseDays(code.nb_journees_hp).mid;
                    if (!isNaN(val) && days > 0) { wSum += val * days; wDays += days; }
                });
            });
        });
        return wDays > 0 ? parseFloat((wSum / wDays).toFixed(2)) : null;
    });

    const ctx = document.getElementById('indicatorTrendChart').getContext('2d');
    if (indicatorTrendChartInstance) indicatorTrendChartInstance.destroy();
    indicatorTrendChartInstance = new Chart(ctx, {
        type: 'line',
        data: { labels: pd.labels, datasets: [{ label, data: seriesData, borderColor: '#38bdf8', tension: 0.3 }] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: {
                        color: '#94a3b8',
                        font: { size: window.innerWidth < 768 ? 9 : 11 }
                    }
                }
            },
            scales: {
                y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', font: { size: window.innerWidth < 768 ? 9 : 11 } } },
                x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: window.innerWidth < 768 ? 9 : 11 } } }
            }
        }
    });
    section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

/**
 * Handles toggling of profile tree checkboxes
 */
window.handleProfileToggle = function (cb) {
    const isChecked = cb.checked;
    if (cb.classList.contains('cm-cb') || cb.classList.contains('gn-cb')) {
        const container = cb.closest('details');
        if (container) {
            container.querySelectorAll('.profile-cb').forEach(d => {
                d.checked = isChecked;
                d.indeterminate = false;
            });
        }
    }
    // Logic for parent indeterminate state omitted for brevity in first draft, 
    // but should be kept if needed. The original had it. Let's include it.

    let currentItem = cb.closest('.gme-item') || cb.closest('details');
    while (currentItem) {
        let parentDetails = currentItem.parentElement.closest('details');
        if (!parentDetails) break;
        let parentCb = parentDetails.querySelector(':scope > summary .profile-cb');
        if (!parentCb) break;
        let childrenContainer = parentDetails.querySelector(':scope > div');
        if (!childrenContainer) break;
        let childCbs = Array.from(childrenContainer.querySelectorAll('.profile-cb'));
        const allChecked = childCbs.length > 0 && childCbs.every(c => c.checked);
        const someChecked = childCbs.some(c => c.checked || c.indeterminate);
        parentCb.checked = allChecked;
        parentCb.indeterminate = (!allChecked && someChecked);
        currentItem = parentDetails;
    }

    updateProfileChart();
};

/**
 * Updates the radial/bar chart for the selected profile items
 */
function updateProfileChart() {
    const allChecked = Array.from(document.querySelectorAll('.profile-cb:checked'));
    const container = document.getElementById('profiling-section');
    if (allChecked.length === 0) { container.style.display = 'none'; return; }
    container.style.display = 'block';

    // Find "root" checked items (checked items with no checked ancestors)
    const rootChecked = allChecked.filter(cb => {
        let current = cb.closest('.gme-item') || cb.closest('details');
        while (current) {
            let parentDetails = current.parentElement?.closest('details');
            if (!parentDetails) break;
            let parentCb = parentDetails.querySelector(':scope > summary .profile-cb');
            if (parentCb && parentCb.checked && parentCb !== cb) return false;
            current = parentDetails;
        }
        return true;
    });

    let dAge = 0, wAge = 0, dSexe = 0, wSexe = 0, dAvqp = 0, wAvqp = 0, dAvqr = 0, wAvqr = 0, dCsarr = 0, wCsarr = 0;
    rootChecked.forEach(rb => {
        const days = parseFloat(rb.dataset.days) || 0;
        const age = parseFloat(rb.dataset.age);
        if (!isNaN(age)) { wAge += age * days; dAge += days; }
        const sexe = parseFloat(rb.dataset.sexe);
        if (!isNaN(sexe)) { wSexe += sexe * days; dSexe += days; }
        const avqp = parseFloat(rb.dataset.avqp);
        if (!isNaN(avqp)) { wAvqp += avqp * days; dAvqp += days; }
        const avqr = parseFloat(rb.dataset.avqr);
        if (!isNaN(avqr)) { wAvqr += avqr * days; dAvqr += days; }
        const csarr = parseFloat(rb.dataset.csarr);
        if (!isNaN(csarr)) { wCsarr += csarr * days; dCsarr += days; }
    });

    const s = [
        dAge > 0 ? (wAge / dAge).toFixed(2) : 0,
        dSexe > 0 ? (wSexe / dSexe).toFixed(2) : 0,
        dAvqp > 0 ? (wAvqp / dAvqp).toFixed(2) : 0,
        dAvqr > 0 ? (wAvqr / dAvqr).toFixed(2) : 0,
        dCsarr > 0 ? (wCsarr / dCsarr).toFixed(2) : 0
    ];
    const g = window.globalMetrics || {};
    const glob = [parseFloat(g.avgAge) || 0, parseFloat(g.avgSexe) || 0, parseFloat(g.avgAVQP) || 0, parseFloat(g.avgAVQR) || 0, parseFloat(g.avgCSARR) || 0];
    const diffs = s.map((v, i) => glob[i] > 0 && parseFloat(v) > 0 ? ((parseFloat(v) - glob[i]) / glob[i]) * 100 : 0);

    const ctx = document.getElementById('profilingChart').getContext('2d');
    if (profilingChartInstance) profilingChartInstance.destroy();
    profilingChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Âge Moyen', 'Sexe Ratio (%H)', 'AVQ Physique', 'AVQ Relationnel', 'Actes CSARR'],
            datasets: [{
                label: 'Écart % vs Moyen',
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
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const val = context.raw.toFixed(2) + '%';
                            const idx = context.dataIndex;
                            const sel = s[idx];
                            const globV = glob[idx];
                            return `${val} (Profil: ${sel} vs Global/Filtre: ${globV})`;
                        }
                    }
                },
                legend: { display: false }
            },
            scales: {
                y: { ticks: { color: '#94a3b8', font: { size: window.innerWidth < 768 ? 9 : 11 } } },
                x: { ticks: { color: '#94a3b8', font: { size: window.innerWidth < 768 ? 9 : 11 } } }
            }
        }
    });
}
window.updateProfileChart = updateProfileChart;

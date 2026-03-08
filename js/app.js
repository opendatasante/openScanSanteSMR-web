let mapping = {};
let officialTotals = {};
let catMajLabels = {};
let gnLabels = {};
let gmeLabels = {};
let table = null;
let chart = null;

async function init() {
    try {
        // 1. Charger l'index (Mapping Finess -> Géo)
        const resp = await fetch('../data/search/finess_geo_mapping.json');
        if (!resp.ok) throw new Error("Index global introuvable. Assurez-vous d'avoir lancé l'export.");
        mapping = await resp.json();

        // Les données "Total" officielles sont désormais incluses dans chaque fichier établissement

        // 3. Charger les libellés des catégories majeures, GN et GME
        try {
            const respOptions = await fetch('../data/search/options.json');
            if (respOptions.ok) {
                const options = await respOptions.json();
                (options.categories_majeures || []).forEach(cat => {
                    catMajLabels[cat.value] = cat.text;
                    (cat.groupes_nosologiques || []).forEach(gn => {
                        gnLabels[gn.value] = gn.text;
                        (gn.groupes_medico_economiques || []).forEach(gme => {
                            gmeLabels[gme.value] = gme.text;
                        });
                    });
                });
            }
        } catch (e) {
            console.warn("Impossible de charger les libellés des catégories:", e);
        }

        // 4. Fetch Latest Update Date from GitHub
        fetchLatestUpdateDate();

        // 3. Populate Filters
        populateFilters();

        // 3. Calculer les statistiques globales pour le dashboard
        updateGlobalStats();

        // 4. Préparer les données pour DataTables
        const tableData = Object.entries(mapping).map(([finess, info]) => [
            finess,
            info.raison_sociale,
            info.dep_name ? `${info.dep_code} - ${info.dep_name}` : info.dep_code,
            info.reg_name,
            info.categorie || 'Secteur Inconnu'
        ]);

        // 5. Initialisation DataTables
        table = $('#main-table').DataTable({
            data: tableData,
            responsive: true,
            order: [[1, 'asc']], // Tri par nom par défaut
            language: {
                url: '//cdn.datatables.net/plug-ins/1.13.6/i18n/fr-FR.json',
                search: "_INPUT_",
                searchPlaceholder: "Rechercher un établissement..."
            },
            pageLength: 15,
            dom: '<"top"f>rt<"bottom"lip><"clear">'
        });

        // 6. Événement clic sur ligne
        $('#main-table tbody').on('click', 'tr', function () {
            const rowData = table.row(this).data();
            if (rowData) loadEstablishment(rowData[0]);
        });

        // 7. Event Listeners for Filters
        $('.filter-select').on('change', function (e) {
            applyFilters(e);
        });

    } catch (err) {
        console.error(err);
        $('header').after(`<div style="background: rgba(239, 68, 68, 0.1); color: #f87171; padding: 1rem; border-radius: 12px; border: 1px solid rgba(239, 68, 68, 0.2); margin-bottom: 2rem;">
        <strong>Erreur de chargement :</strong> ${err.message}<br>
        <small>Vérifiez que le fichier <code>finess_geo_mapping.json</code> existe dans <code>data/search/</code>.</small>
    </div>`);
    }
}

function populateFilters() {
    const sites = Object.values(mapping);

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
}

function updateDeptFilter() {
    const selectedRegion = document.getElementById('filter-region').value;
    const sites = Object.values(mapping);
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

function applyFilters(event) {
    const regVal = document.getElementById('filter-region').value;
    const deptVal = document.getElementById('filter-dept').value;
    const sectorVal = document.getElementById('filter-sector').value;

    // Handle dependency: if region changes, update depts
    if (event && event.target && event.target.id === 'filter-region') {
        updateDeptFilter();
    }

    // Apply filtering to DataTables
    // Col 2: Dept (index 2)
    // Col 3: Region (index 3)
    // Col 4: Categorie (index 4)

    table.column(3).search(regVal);

    if (deptVal) {
        // Use exact match for dept since we have "01 - AIN" and might have "01 - AIN..."
        table.column(2).search('^' + deptVal.replace(/-/g, '\\-') + '$', true, false);
    } else {
        table.column(2).search('');
    }

    table.column(4).search(sectorVal);

    table.draw();

    // Update Stats based on filtered data
    updateGlobalStats();
}

function updateGlobalStats() {
    let sites;
    if (table) {
        // Get rows that match the current filter correctly
        const filteredData = table.rows({ filter: 'applied' }).data().toArray();
        const filteredFiness = filteredData.map(r => r[0]); // FINESS is in the first column
        sites = filteredFiness.map(f => mapping[f]).filter(Boolean); // filter Boolean just in case
    } else {
        sites = Object.values(mapping);
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

// Close drawer on Escape key
document.addEventListener('keydown', function (event) {
    if (event.key === "Escape" || event.key === "Esc") {
        closeDetails();
    }
});

async function loadEstablishment(finess) {
    // Reset & Show Drawer
    document.getElementById('detail-view').style.display = 'block';
    document.getElementById('det-name').textContent = mapping[finess].raison_sociale;
    document.getElementById('det-metrics').innerHTML = '<div style="color: var(--text-muted)">Chargement de l\'historique...</div>';
    document.getElementById('det-raw').textContent = "Accès aux fichiers JSON de l'établissement...";

    try {
        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        let historyFiles = [];

        if (isLocal) {
            // En local, on teste avec latest.json directement au lieu de requêter l'API GitHub
            historyFiles = [{
                name: 'latest.json',
                download_url: `../data/restitutions/etablissements/${finess}/latest.json?t=${new Date().getTime()}`
            }];
        } else {
            // 1. Lister les fichiers dans le dossier GitHub de l'établissement
            historyFiles = await fetchHistory(finess);
        }

        if (historyFiles.length === 0) {
            throw new Error("Aucune donnée trouvée pour cet établissement.");
        }

        // 2. Charger tous les fichiers en parallèle
        // On récupère le contenu brut via l'URL 'download_url' fournie par GitHub
        const dataPromises = historyFiles.map(file => fetch(file.download_url).then(r => r.json()));
        const allHistoricalData = await Promise.all(dataPromises);

        // 3. Fusionner les données (par ordre chronologique pour que le plus récent écrase l'ancien)
        // Les fichiers sont déjà triés par nom (date) par fetchHistory
        let mergedData = {
            finess: finess,
            raison_sociale: mapping[finess].raison_sociale,
            geo: mapping[finess],
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
        console.error(err);
        document.getElementById('det-raw').innerHTML = `<span style="color: #ef4444">⚠️ ${err.message}</span>`;
        if (chart) chart.destroy();
        document.getElementById('det-metrics').innerHTML = "";
        document.getElementById('det-smr-metrics').innerHTML = "";
        document.getElementById('det-meta-top').innerHTML = "";
    }
}

async function fetchHistory(finess) {
    const repo = "sebastiencys/openScanSanteSMR-data";
    const path = `data/restitutions/etablissements/${finess}`;
    const url = `https://api.github.com/repos/${repo}/contents/${path}`;

    const resp = await fetch(url);
    if (!resp.ok) {
        if (resp.status === 404) return [];
        throw new Error(`GitHub API Error: ${resp.statusText}`);
    }

    const files = await resp.json();

    // Filtrer : uniquement les JSON, exclure 'latest.json'
    // Trier par nom (ordre alphabétique = chronologique car format ISO ou YYYY-MM-DD)
    return files
        .filter(f => f.name.endsWith('.json') && f.name !== 'latest.json')
        .sort((a, b) => a.name.localeCompare(b.name));
}

function renderDetails(data) {
    const periodes = Object.keys(data.periodes || {}).sort();

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
    document.getElementById('det-name').textContent = data.raison_sociale || "Établissement inconnu";

    if (periodes.length > 0) {
        const labels = periodes;

        // Compute per-period totals: total, HC, HP
        const sumForPeriod = (p, field) => {
            let total = 0;
            Object.entries(data.periodes[p] || {}).forEach(([k, gns]) => {
                if (k === 'total') return;
                Object.values(gns || {}).forEach(gmes => {
                    Object.values(gmes || {}).forEach(code => {
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
            let catTotal = 0;
            fullBreakdown[catMaj] = { total: 0, gns: {}, wAge: 0, dAge: 0, wSexe: 0, dSexe: 0, wAvqp: 0, dAvqp: 0, wAvqr: 0, dAvqr: 0, wCsarr: 0, sCsarr: 0 };

            Object.entries(gns || {}).forEach(([gnId, gmes]) => {
                let gnTotal = 0;
                fullBreakdown[catMaj].gns[gnId] = { total: 0, gmes: {}, wAge: 0, dAge: 0, wSexe: 0, dSexe: 0, wAvqp: 0, dAvqp: 0, wAvqr: 0, dAvqr: 0, wCsarr: 0, sCsarr: 0 };

                Object.entries(gmes || {}).forEach(([gmeId, code]) => {
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
            if (!off) return { text: `${calc}${unitHtml}`, match: true };
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
            if (el.textContent.includes("Dernière Période Connue") || el.textContent.includes("Période :")) {
                el.textContent = `Période : ¹${lastP}`.replace('¹', '');
            }
        });

        document.getElementById('det-smr-metrics').innerHTML = `
        <div class="metric-card" style="cursor: pointer;" onclick="window.showIndicatorTrend('age_moyen', 'Âge Moyen', 'ans')">
            <div class="metric-label">Âge Moyen <span style="font-size:0.7em; color: var(--text-muted);">(év. ▶)</span></div>
            <div class="metric-value">${compare(avgAge, official.age_moyen, " ans").text}</div>
        </div>
        <div class="metric-card" style="cursor: pointer;" onclick="window.showIndicatorTrend('sexe_ratio', 'Sexe Ratio', '%H')">
            <div class="metric-label">Sexe Ratio <span style="font-size:0.7em; color: var(--text-muted);">(év. ▶)</span></div>
            <div class="metric-value">${compare(avgSexe, official.sexe_ratio, "% H").text}</div>
        </div>
        <div class="metric-card" style="cursor: pointer;" onclick="window.showIndicatorTrend('avq_physique', 'AVQ Physique', '/4')">
            <div class="metric-label">AVQ Physique <span style="font-size:0.7em; color: var(--text-muted);">(év. ▶)</span></div>
            <div class="metric-value">${compare(avgAVQP, official.avq_physique, " /4").text}</div>
        </div>
        <div class="metric-card" style="cursor: pointer;" onclick="window.showIndicatorTrend('avq_relationnel', 'AVQ Relationnel', '/4')">
            <div class="metric-label">AVQ Relationnel <span style="font-size:0.7em; color: var(--text-muted);">(év. ▶)</span></div>
            <div class="metric-value">${compare(avgAVQR, official.avq_relationnel, " /4").text}</div>
        </div>
        <div class="metric-card" style="cursor: pointer;" onclick="window.showIndicatorTrend('nb_actes_csarr', 'Actes CSARR', '/j.')">
            <div class="metric-label">Actes CSARR <span style="font-size:0.7em; color: var(--text-muted);">(év. ▶)</span></div>
            <div class="metric-value">${compare(avgCSARR, official.nb_actes_csarr, " /j.").text}</div>
        </div>
        `;

        // Generic stat tooltip generator
        const buildInfoTooltip = (title, age, sexe, avqp, avqr, csarr) => {
            let parts = [];
            if (age && age !== "N/A" && !isNaN(parseFloat(age))) parts.push(`Âge moyen: ${parseFloat(age).toFixed(1)} ans (Moy. Globale: ${avgAge})`);
            if (sexe && sexe !== "N/A" && !isNaN(parseFloat(sexe))) parts.push(`Sexe Ratio: ${parseFloat(sexe).toFixed(1)}% H (Moy. Globale: ${avgSexe})`);
            if (avqp && avqp !== "N/A" && !isNaN(parseFloat(avqp))) parts.push(`AVQ Physique: ${parseFloat(avqp).toFixed(2)} /4 (Moy. Globale: ${avgAVQP})`);
            if (avqr && avqr !== "N/A" && !isNaN(parseFloat(avqr))) parts.push(`AVQ Relationnel: ${parseFloat(avqr).toFixed(2)} /4 (Moy. Globale: ${avgAVQR})`);
            if (csarr && csarr !== "N/A" && !isNaN(parseFloat(csarr))) parts.push(`Actes CSARR: ${parseFloat(csarr).toFixed(2)} /j. (Moy. Globale: ${avgCSARR})`);
            if (parts.length === 0) return '';
            return `<span title="Indicateurs de profil pour '${title.replace(/"/g, '&quot;')}':&#10;${parts.join('&#10;')}" style="cursor:help; font-size: 0.9em; vertical-align: middle; filter: grayscale(1); opacity: 0.6; margin-left: 0.3rem;">ℹ️</span>`;
        };



        // Render Activity Breakdown Hierarchical
        let breakdownHtml = '<div style="margin-top: 1rem; background: rgba(255,255,255,0.03); border-radius: 12px; padding: 1rem; border: 1px solid rgba(255,255,255,0.05);">';
        breakdownHtml += '<h4 style="margin: 0 0 1rem 0; font-size: 0.9rem; color: var(--primary-light);">Détail de l\'Activité (CM > GN > GME)</h4>';

        const sortedCMs = Object.entries(fullBreakdown).sort((a, b) => b[1].total - a[1].total);

        if (sortedCMs.length > 0) {
            sortedCMs.forEach(([cmId, cmData]) => {
                const cmLabel = catMajLabels[cmId] || cmId;

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
                    const gnLabel = gnLabels[gnId] || gnId;
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
                        const gmeLabel = gmeLabels[gmeId] || gmeId;
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

        document.getElementById('det-raw').innerHTML = `
            <p style="margin-bottom: 1rem;">Consolidation effectuée sur les données PMSI-SMR.</p>
            ${breakdownHtml}
        `;
    } else {
        document.getElementById('det-raw').textContent = "Aucun historique disponible.";
        document.getElementById('det-metrics').innerHTML = "";
        document.getElementById('det-smr-metrics').innerHTML = "";
    }
}

async function fetchLatestUpdateDate() {
    try {
        const resp = await fetch('https://api.github.com/repos/sebastiencys/openScanSanteSMR-data/releases/latest');
        if (!resp.ok) throw new Error("GitHub API Error");
        const data = await resp.json();
        const dateStr = data.published_at.split('T')[0];
        document.getElementById('update-badge').innerHTML = `Dernière mise à jour : ${dateStr}`;
        document.getElementById('update-badge').title = data.name || "Nouvelles données";
    } catch (err) {
        console.warn("Impossible de récupérer la date de mise à jour dynamique:", err);
        document.getElementById('update-badge').textContent = "Données : Mars 2026 (Live)";
    }
}

function updateChart(labels, dataArr, hcArr, hpArr) {
    const ctx = document.getElementById('detailChart').getContext('2d');
    if (chart) chart.destroy();

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
            label: 'HC',
            data: hcArr,
            borderColor: '#34d399',
            borderWidth: 1.5,
            pointRadius: 3,
            pointHoverRadius: 5,
            backgroundColor: 'transparent',
            fill: false,
            tension: 0.3,
            borderDash: [4, 3]
        });
    }
    if (hpArr && hpArr.some(v => v > 0)) {
        datasets.push({
            label: 'HP',
            data: hpArr,
            borderColor: '#f59e0b',
            borderWidth: 1.5,
            pointRadius: 3,
            pointHoverRadius: 5,
            backgroundColor: 'transparent',
            fill: false,
            tension: 0.3,
            borderDash: [4, 3]
        });
    }

    chart = new Chart(ctx, {
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

// ----------------------------------------------------
// Interactive Profiling Chart Logic
// ----------------------------------------------------
let profilingChartInstance = null;

window.handleProfileToggle = function (cb) {
    const isChecked = cb.checked;

    // 1. Propagate downwards (check all children)
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

    // 2. Propagate upwards (sync parents)
    let currentItem = cb.closest('.gme-item') || cb.closest('details');
    while (currentItem) {
        let parentDetails = currentItem.parentElement.closest('details');
        if (!parentDetails) break;

        let parentCb = parentDetails.querySelector(':scope > summary .profile-cb');
        if (!parentCb) break;

        // Find the direct children container
        let childrenContainer = parentDetails.querySelector(':scope > div');
        if (!childrenContainer) break;

        // Collect all direct child checkboxes (GN summary cb or GME cb)
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

    // 3. Update the chart based on current selection
    updateProfileChart();
};

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
        // Using 'days' identically as stays (csarr uses days in current iteration too)
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
                            return `${val} (Sélection: ${sel} vs Global: ${globV})`;
                        }
                    }
                },
                legend: { display: false }
            },
            scales: {
                x: {
                    title: { display: true, text: "Écart par rapport à la moyenne globale de l'établissement (%)", color: '#94a3b8' },
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#cbd5e1' }
                },
                y: {
                    grid: { display: false },
                    ticks: { color: '#cbd5e1' }
                }
            }
        }
    });
};

function closeDetails() { document.getElementById('detail-view').style.display = 'none'; }

// ----------------------------------------------------
// Indicator Temporal Trend
// ----------------------------------------------------
let indicatorTrendChartInstance = null;

window.showIndicatorTrend = function (field, label, unit) {
    const pd = window.allPeriodes;
    if (!pd) return;

    const section = document.getElementById('indicator-trend-section');
    const titleEl = document.getElementById('indicator-trend-title');
    titleEl.textContent = `\u00c9volution : ${label} (${unit})`;
    section.style.display = 'block';

    const seriesData = pd.labels.map(p => {
        let wSum = 0, wDays = 0;
        Object.entries(pd.rawData[p] || {}).forEach(([k, gns]) => {
            if (k === 'total') return;
            Object.values(gns || {}).forEach(gmes => {
                Object.values(gmes || {}).forEach(code => {
                    const val = parseFloat(code[field]);
                    const days = (parseInt(code.nb_journees_hc) || 0) + (parseInt(code.nb_journees_hp) || 0);
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

    // Scroll the section into view
    section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

$(document).ready(init);

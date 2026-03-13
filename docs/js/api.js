// js/api.js
import { state, config } from './state.js';

// --- Utilitaires du Secret Statistique (API) ---
// On les place ici pour éviter une dépendance circulaire avec ui.js
export function parseDaysAPI(val) {
    if (val === undefined || val === null || val === "NA" || val === "N/A" || val === "") {
        return { min: 0, max: 0, isExact: true, mid: 0 };
    }
    if (val === "1 à 10" || val === "< 11") {
        return { min: 1, max: 10, isExact: false, mid: 5.5 };
    }
    const num = parseInt(val) || 0;
    return { min: num, max: num, isExact: true, mid: num };
}

export function addStatsAPI(s1, s2) {
    return {
        min: s1.min + s2.min,
        max: s1.max + s2.max,
        isExact: s1.isExact && s2.isExact,
        mid: s1.mid + s2.mid
    };
}
// ------------------------------------------------

export async function fetchInitialData() {
    // 1. Charger l'index (Mapping Finess -> Géo)
    const mappingUrl = `${config.dataBaseUrl}/search/finess_geo_mapping_enrichis.json`;
    const resp = await fetch(mappingUrl);
    if (!resp.ok) throw new Error(`Index introuvable (HTTP ${resp.status})`);
    state.mapping = await resp.json();

    // 2. Charger les totaux globaux
    try {
        const urlTotal = `${config.cdnPrefix}data/restitutions/total/latest.json`;
        const respTotal = await fetch(urlTotal);
        const jsonTotal = await respTotal.json();
        jsonTotal.data.forEach(row => {
            const f = row.finess;
            if (state.mapping[f]) {
                const statTotal = parseDaysAPI(row.nb_journees_total);
                const statHc = parseDaysAPI(row.nb_journees_hc);
                const statHp = parseDaysAPI(row.nb_journees_hp);

                // On stocke les objets complets pour générer de jolis affichages (avec "1 à 10")
                state.mapping[f].stat_total = statTotal;
                state.mapping[f].stat_hc = statHc;
                state.mapping[f].stat_hp = statHp;

                // Rétrocompatibilité : On maintient les propriétés historiques avec la valeur numérique (.mid)
                // Cela empêche le tri des colonnes de Datatables ou les cercles de Leaflet de casser
                state.mapping[f].total_journees = statTotal.mid;
                state.mapping[f].total_hc = statHc.mid;
                state.mapping[f].total_hp = statHp.mid;
            }
        });
    } catch (e) { console.warn("Impossible de charger les totaux :", e); }

    // 3. Charger les options et libellés
    try {
        const respOptions = await fetch(`${config.dataBaseUrl}/search/options.json`);
        if (respOptions.ok) {
            const options = await respOptions.json();
            state.optionsTree = options.categories_majeures || [];
            (options.categories_majeures || []).forEach(cat => {
                state.catMajLabels[cat.value] = cat.text;
                (cat.groupes_nosologiques || []).forEach(gn => {
                    state.gnLabels[gn.value] = gn.text;
                    (gn.groupes_medico_economiques || []).forEach(gme => {
                        state.gmeLabels[gme.value] = gme.text;
                    });
                });
            });
        }
    } catch (e) { console.warn("Erreur libellés:", e); }
}

export async function fetchHistory(finess) {
    const index = await fetch(config.indexUrl).then(r => r.json());
    return index[finess] || [];
}

export async function fetchLatestUpdateDate() {
    try {
        const resp = await fetch(config.releaseUrl);
        const data = await resp.json();
        const dateStr = data.published_at.split('T')[0];
        document.getElementById('update-badge').innerHTML = `Dernière mise à jour : ${dateStr}`;
        document.getElementById('update-badge').title = data.name || "Nouvelles données";
    } catch (err) {
        document.getElementById('update-badge').textContent = "Données : Mars 2026 (Live)";
    }
}

export async function fetchMapActivityData(selectedCms, selectedGns, selectedGmes) {
    let paths = [];

    // On s'assure que ce sont bien des tableaux (arrays)
    const cms = Array.isArray(selectedCms) ? selectedCms : (selectedCms ? [selectedCms] : []);
    const gns = Array.isArray(selectedGns) ? selectedGns : (selectedGns ? [selectedGns] : []);
    const gmes = Array.isArray(selectedGmes) ? selectedGmes : (selectedGmes ? [selectedGmes] : []);

    // On parcourt l'arbre pour déterminer les chemins optimaux
    state.optionsTree.forEach(cm => {
        if (cms.length > 0 && !cms.includes(cm.value)) return;

        // OPTIMISATION 1
        if (gns.length === 0 && gmes.length === 0) {
            paths.push(`${cm.value}`);
            return;
        }

        (cm.groupes_nosologiques || []).forEach(gn => {
            if (gns.length > 0 && !gns.includes(gn.value)) return;

            // OPTIMISATION 2
            if (gmes.length === 0) {
                paths.push(`${cm.value}/${gn.value}`);
                return;
            }

            (gn.groupes_medico_economiques || []).forEach(gme => {
                if (gmes.length > 0 && !gmes.includes(gme.value)) return;
                paths.push(`${cm.value}/${gn.value}/${gme.value}`);
            });
        });
    });

    const customData = {};

    const promises = paths.map(pathStr =>
        fetch(`${config.cdnPrefix}data/restitutions/${pathStr}/latest.json`)
            .then(r => r.ok ? r.json() : null)
            .catch(() => null)
    );

    const results = await Promise.all(promises);

    // On agrège les journées par établissement
    results.forEach(file => {
        if (file && file.data) {
            file.data.forEach(row => {
                const f = row.finess;

                // On extrait les intervalles
                const hcStat = parseDaysAPI(row.nb_journees_hc);
                const hpStat = parseDaysAPI(row.nb_journees_hp);
                const daysStat = addStatsAPI(hcStat, hpStat);

                // Initialisation en tant qu'objet si premier passage
                if (!customData[f]) {
                    customData[f] = { val: 0, stat: parseDaysAPI(0) };
                }

                // Agrégation des objets intervalles
                customData[f].stat = addStatsAPI(customData[f].stat, daysStat);
                // Mise à jour de la valeur continue (médiane) pour dimensionner les cercles de la carte
                customData[f].val = customData[f].stat.mid;
            });
        }
    });

    return customData;
}
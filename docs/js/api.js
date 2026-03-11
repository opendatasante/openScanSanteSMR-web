// js/api.js
import { state, config } from './state.js';

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
                state.mapping[f].total_journees = parseInt(row.nb_journees_total) || 0;
                state.mapping[f].total_hc = parseInt(row.nb_journees_hc) || 0;
                state.mapping[f].total_hp = parseInt(row.nb_journees_hp) || 0;
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

    // On parcourt l'arbre pour trouver tous les GME qui correspondent au filtre
    state.optionsTree.forEach(cm => {
        if (cms.length > 0 && !cms.includes(cm.value)) return;
        (cm.groupes_nosologiques || []).forEach(gn => {
            if (gns.length > 0 && !gns.includes(gn.value)) return;
            (gn.groupes_medico_economiques || []).forEach(gme => {
                if (gmes.length > 0 && !gmes.includes(gme.value)) return;
                paths.push({ cm: cm.value, gn: gn.value, gme: gme.value });
            });
        });
    });

    const customData = {};

    // On lance tous les téléchargements en parallèle (très rapide grâce au CDN)
    const promises = paths.map(p =>
        fetch(`${config.cdnPrefix}data/restitutions/${p.cm}/${p.gn}/${p.gme}/latest.json`)
            .then(r => r.ok ? r.json() : null)
            .catch(() => null)
    );

    const results = await Promise.all(promises);

    // On agrège les journées par établissement
    results.forEach(file => {
        if (file && file.data) {
            file.data.forEach(row => {
                const f = row.finess;
                const days = (parseInt(row.nb_journees_hc) || 0) + (parseInt(row.nb_journees_hp) || 0);
                if (!customData[f]) customData[f] = 0;
                customData[f] += days;
            });
        }
    });

    return customData;
}
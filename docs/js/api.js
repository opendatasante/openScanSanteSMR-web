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

    // On parcourt l'arbre pour déterminer les chemins optimaux
    state.optionsTree.forEach(cm => {
        // Si des CM sont sélectionnées et que celle-ci n'y est pas, on l'ignore
        if (cms.length > 0 && !cms.includes(cm.value)) return;

        // OPTIMISATION 1 : Si aucun filtre GN ni GME n'est actif, on prend directement le fichier de la CM
        if (gns.length === 0 && gmes.length === 0) {
            paths.push(`${cm.value}`); // Ex: "01"
            return; // On passe à la CM suivante sans explorer ses enfants
        }

        (cm.groupes_nosologiques || []).forEach(gn => {
            // Si des GN sont sélectionnés et que celui-ci n'y est pas, on l'ignore
            if (gns.length > 0 && !gns.includes(gn.value)) return;

            // OPTIMISATION 2 : Si aucun filtre GME n'est actif, on prend directement le fichier du GN
            if (gmes.length === 0) {
                paths.push(`${cm.value}/${gn.value}`); // Ex: "01/01C"
                return; // On passe au GN suivant sans explorer ses GME
            }

            (gn.groupes_medico_economiques || []).forEach(gme => {
                // Si des GME sont sélectionnés et que celui-ci n'y est pas, on l'ignore
                if (gmes.length > 0 && !gmes.includes(gme.value)) return;

                // Niveau le plus bas : on prend le fichier du GME spécifique
                paths.push(`${cm.value}/${gn.value}/${gme.value}`); // Ex: "01/01C/01C031"
            });
        });
    });

    const customData = {};

    // On lance tous les téléchargements en parallèle en ajoutant simplement "/latest.json" à nos chemins
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
                const days = (parseInt(row.nb_journees_hc) || 0) + (parseInt(row.nb_journees_hp) || 0);
                if (!customData[f]) customData[f] = 0;
                customData[f] += days;
            });
        }
    });

    return customData;
}
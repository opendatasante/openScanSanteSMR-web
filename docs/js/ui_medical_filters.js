// js/ui_medical_filters.js
import { state } from './state.js';
import { fetchMapActivityData } from './api.js';
import { refreshViews } from './map.js';
import { updateGlobalStats } from './ui_main.js';

let showAllOptions = false;

/**
 * Initializes the medical/activity filters (CM, GN, GME)
 */
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
        window.showAllOptions = showAllOptions; // Keep globally synced for now
        clearActivityFilters();
        rebuildAllOptions();
    });

    $('#btn-clear-filters').on('click', function () {
        clearActivityFilters();
    });

    $cm.on('change', async () => {
        let cmVals = $cm.val() || [];
        cmVals = Array.isArray(cmVals) ? cmVals.filter(v => v && v !== 'ALL') : (cmVals ? [cmVals] : []);

        if (!showAllOptions) {
            $('#filter-gn').val(null).trigger('change.select2');
            $('#filter-gme').empty();
            $('#filter-gme').val(null).trigger('change.select2');
            rebuildAllOptions();
        }

        await applyActivityFilter();
    });

    $gn.on('change', async () => {
        const cmVals = ($('#filter-cm').val() || []).filter(v => v && v !== 'ALL');
        const gnVals = ($('#filter-gn').val() || []).filter(Boolean);

        const $gme = $('#filter-gme');

        if (!showAllOptions) {
            $gme.empty();
            $gme.val(null).trigger('change.select2');
            rebuildAllOptions();
        }

        await applyActivityFilter();
    });



    $gme.on('change', async () => {
        await applyActivityFilter();
    });
}

/**
 * Captures current medical filter values
 */
export function captureMedicalFilters() {
    const selCms = ($('#filter-cm').val() || []).filter(v => v && v !== 'ALL');
    const selGns = ($('#filter-gn').val() || []).filter(Boolean);
    const selGmes = ($('#filter-gme').val() || []).filter(Boolean);
    const hasFilter = selCms.length > 0 || selGns.length > 0 || selGmes.length > 0;

    window.currentMedicalFilters = { selCms, selGns, selGmes, hasFilter };
    return window.currentMedicalFilters;
}

/**
 * Applies medical filters to the map and table
 */
export async function applyActivityFilter() {
    const rawCm = ($('#filter-cm').val() || []);
    const cm = Array.isArray(rawCm) ? rawCm.filter(v => v && v !== 'ALL') : (rawCm ? [rawCm] : []);
    const gn = ($('#filter-gn').val() || []).filter(v => v && v !== '');
    const gme = ($('#filter-gme').val() || []).filter(v => v && v !== '');

    const hasAnyMedicalFilter = (cm.length > 0) || (gn.length > 0) || (gme.length > 0);
    const allowGnOnly = !!showAllOptions;

    if (!hasAnyMedicalFilter && !allowGnOnly) {
        state.mapCustomData = null;
    } else {
        document.body.style.cursor = 'wait';
        const mapBtn = document.getElementById('btn-map');
        const originalText = mapBtn ? mapBtn.textContent : null;
        if (mapBtn) mapBtn.textContent = "Calcul en cours...";

        try {
            state.mapCustomData = await fetchMapActivityData(cm, gn, gme, showAllOptions);

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

/**
 * Clears all activity filters
 */
export function clearActivityFilters() {
    const $cm = $('#filter-cm');
    const $gn = $('#filter-gn');
    const $gme = $('#filter-gme');

    $cm.val(null).trigger('change.select2');
    $gn.empty();
    $gme.empty();
    $gn.val(null).trigger('change.select2');
    $gme.val(null).trigger('change.select2');

    rebuildAllOptions();
    applyActivityFilter();
}

/**
 * Rebuilds GN and GME options based on CM selection and "show all" toggle
 */
let isOptionsPopulated = false;

export function rebuildAllOptions() {
    const $cm = $('#filter-cm');
    const $gn = $('#filter-gn');
    const $gme = $('#filter-gme');

    if (showAllOptions) {
        if (!isOptionsPopulated) {
            $gn.empty();
            $gme.empty();
            const gnSeen = new Set();
            const gmeSeen = new Set();

            state.optionsTree.forEach(cmNode => {
                const gns = cmNode.groupes_nosologiques || [];
                gns.forEach(gn => {
                    if (!gnSeen.has(gn.value)) {
                        gnSeen.add(gn.value);
                        $gn.append(new Option(gn.text, gn.value));
                    }
                    const gmes = gn.groupes_medico_economiques || [];
                    gmes.forEach(gme => {
                        if (!gmeSeen.has(gme.value)) {
                            gmeSeen.add(gme.value);
                            $gme.append(new Option(gme.text, gme.value));
                        }
                    });
                });
            });
            isOptionsPopulated = true;
        }
    } else {
        isOptionsPopulated = false; // Reset if we leave "Show All"
        const cmVals = ($cm.val() || []).filter(v => v && v !== 'ALL');
        const gnVals = ($gn.val() || []).filter(Boolean);
        const gmeVals = ($gme.val() || []).filter(Boolean);

        $gn.empty();
        $gme.empty();

        if (cmVals.length > 0) {
            state.optionsTree.filter(c => cmVals.includes(c.value)).forEach(cmNode => {
                (cmNode.groupes_nosologiques || []).forEach(gn => {
                    $gn.append(new Option(`${gn.text}`, gn.value));
                });
            });
            $gn.val(gnVals.filter(v => $gn.find(`option[value="${v}"]`).length > 0)).trigger('change.select2');
        }

        if (gnVals.length > 0) {
            state.optionsTree.filter(c => cmVals.includes(c.value)).forEach(cmNode => {
                (cmNode.groupes_nosologiques || []).forEach(gnNode => {
                    if (gnVals.includes(gnNode.value)) {
                        (gnNode.groupes_medico_economiques || []).forEach(gme => {
                            $gme.append(new Option(`${gme.text}`, gme.value));
                        });
                    }
                });
            });
            $gme.val(gmeVals.filter(v => $gme.find(`option[value="${v}"]`).length > 0)).trigger('change.select2');
        }
    }
}




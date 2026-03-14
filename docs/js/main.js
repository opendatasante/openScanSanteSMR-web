// js/main.js
import { state } from './state.js';
import { fetchInitialData, fetchLatestUpdateDate } from './api.js';
import { initMap, refreshViews } from './map.js';
import { initUI, updateGlobalStats, wireGlobals } from './ui_main.js';
import { applyFilters } from './ui_filters.js';
import { loadEstablishment } from './ui_details.js';
import { initActivityFilters } from './ui_medical_filters.js';
import { formatStat } from './ui_utils.js';
import { openComparison } from './ui_comparison.js';


async function init() {
    try {
        await fetchInitialData();
        await fetchLatestUpdateDate();

        initUI();
        initActivityFilters();

        // Initialisation DataTables
        const tableData = Object.entries(state.mapping).map(([finess, info]) => [
            '',
            finess,
            info.raison_sociale,
            info.dep_name ? `${info.dep_code} - ${info.dep_name}` : info.dep_code,
            info.reg_name,
            info.categorie || 'Secteur Inconnu',
            info.total_journees || 0
        ]);

        state.table = $('#main-table').DataTable({
            data: tableData,
            responsive: true,
            order: [[2, 'asc']], // [[6, 'desc']] si on veut trier par journées
            language: { url: '//cdn.datatables.net/plug-ins/1.13.6/i18n/fr-FR.json' },
            pageLength: 25,
            dom: '<"top"f>rt<"bottom"lip><"clear">',
            columnDefs: [
                {
                    targets: 0,
                    orderable: false,
                    className: 'select-checkbox',
                    render: function (data, type, row) {
                        const isChecked = state.selectedFiness.includes(row[1]) ? 'checked' : '';
                        return `<input type="checkbox" class="est-checkbox" data-finess="${row[1]}" ${isChecked}>`;
                    }
                },
                {
                    targets: 6, // Notre colonne "Journées"
                    render: function (data, type, row) {
                        const finess = row[1]; // FINESS est à l'index 1
                        let val = 0;
                        let statObj = null;

                        // Récupération de la donnée continue (val) ET de l'objet d'incertitude (statObj)
                        if (state.mapCustomData && state.mapCustomData[finess]) {
                            val = state.mapCustomData[finess].val ?? 0;
                            statObj = state.mapCustomData[finess].stat;
                        } else {
                            val = state.mapping[finess]?.total_journees || 0;
                            statObj = state.mapping[finess]?.stat_total;
                        }

                        // Format pour l'affichage visuel (le texte rendu dans le HTML)
                        if (type === 'display') {
                            if (statObj) {
                                // On utilise notre belle fonction de formatage pour afficher "1 à 10 j. 🔒"
                                return formatStat(statObj, "j.");
                            }
                            return val.toLocaleString() + ' j.';
                        }

                        // Format brut pour le tri interne (DataTables classera correctement 5.5 entre 0 et 11)
                        return val;
                    }
                }
            ]
        });

        $.fn.dataTable.ext.search.push(function (settings, data, dataIndex) {
            if (!state.mapCustomData) return true;

            const finess = data[1];
            const entry = state.mapCustomData?.[finess];
            const volume = entry?.val ?? 0;

            return volume > 0;
        });

        updateGlobalStats();

        // Événements
        $('#main-table tbody').on('click', 'tr', function (e) {
            // Si on clique sur la checkbox, on ne charge pas l'établissement
            if (e.target.classList.contains('est-checkbox')) return;

            const rowData = state.table.row(this).data();
            if (rowData) loadEstablishment(rowData[1]); // FINESS is now index 1
        });

        // Gestion des checkboxes
        $('#main-table tbody').on('change', '.est-checkbox', function () {
            const finess = $(this).data('finess');
            if (this.checked) {
                if (!state.selectedFiness.includes(finess)) state.selectedFiness.push(finess);
            } else {
                state.selectedFiness = state.selectedFiness.filter(f => f !== finess);
            }
            updateComparisonBar();
        });

        // Select All
        $('#select-all-establishments').on('change', function () {
            const isChecked = this.checked;
            $('.est-checkbox').each(function () {
                this.checked = isChecked;
                const finess = $(this).data('finess');
                if (isChecked) {
                    if (!state.selectedFiness.includes(finess)) state.selectedFiness.push(finess);
                } else {
                    state.selectedFiness = state.selectedFiness.filter(f => f !== finess);
                }
            });
            updateComparisonBar();
        });

        $('#btn-clear-selection').on('click', () => {
            state.selectedFiness = [];
            $('.est-checkbox').prop('checked', false);
            $('#select-all-establishments').prop('checked', false);
            updateComparisonBar();
        });

        $('#btn-compare').on('click', () => {
            openComparison();

        });

        $('.filter-select').not('#filter-cm, #filter-gn, #filter-gme').on('change', applyFilters);


        // Popups
        $('#link-about').on('click', (e) => {
            e.preventDefault();
            document.getElementById('popup-about').style.display = 'block';
        });

        $('#link-features').on('click', (e) => {
            e.preventDefault();
            document.getElementById('popup-features').style.display = 'block';
        });


    } catch (err) {
        console.error(err);
        $('header').after(`<div style="color: #f87171;">Erreur: ${err.message}</div>`);
    }
}

// Gestion de la bascule Liste / Carte
document.getElementById("btn-list").onclick = () => {
    state.currentView = "list";
    document.getElementById("btn-list").classList.add("active");
    document.getElementById("btn-map").classList.remove("active");
    document.getElementById("main-table_wrapper").style.display = "block";
    document.getElementById("map-view").style.display = "none";
    refreshViews();
};

document.getElementById("btn-map").onclick = () => {
    state.currentView = "map";
    document.getElementById("btn-map").classList.add("active");
    document.getElementById("btn-list").classList.remove("active");
    document.getElementById("main-table_wrapper").style.display = "none";
    document.getElementById("map-view").style.display = "block";
    initMap();
    refreshViews();
};

// Mise à jour de la barre de comparaison
function updateComparisonBar() {
    const bar = document.getElementById('comparison-bar');
    const countEl = document.getElementById('comparison-count');
    const count = state.selectedFiness.length;

    if (count >= 2) {
        bar.style.display = 'flex';
        countEl.textContent = count;
    } else {
        bar.style.display = 'none';
        // Deselect the "select all" checkbox if count drops
        if (count === 0) $('#select-all-establishments').prop('checked', false);
    }
}

// Lancement au chargement
$(document).ready(init);
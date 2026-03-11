// js/main.js
import { state } from './state.js';
import { fetchInitialData, fetchLatestUpdateDate } from './api.js';
import { initMap, refreshViews } from './map.js';
import { populateFilters, applyFilters, updateGlobalStats, loadEstablishment } from './ui.js';

async function init() {
    try {
        await fetchInitialData();
        await fetchLatestUpdateDate();

        populateFilters();

        // Initialisation DataTables
        const tableData = Object.entries(state.mapping).map(([finess, info]) => [
            finess,
            info.raison_sociale,
            info.dep_name ? `${info.dep_code} - ${info.dep_name}` : info.dep_code,
            info.reg_name,
            info.categorie || 'Secteur Inconnu'
        ]);

        state.table = $('#main-table').DataTable({
            data: tableData,
            responsive: true,
            order: [[1, 'asc']],
            language: { url: '//cdn.datatables.net/plug-ins/1.13.6/i18n/fr-FR.json' },
            pageLength: 15,
            dom: '<"top"f>rt<"bottom"lip><"clear">'
        });

        updateGlobalStats();

        // Événements
        $('#main-table tbody').on('click', 'tr', function () {
            const rowData = state.table.row(this).data();
            if (rowData) loadEstablishment(rowData[0]);
        });

        $('.filter-select').on('change', applyFilters);

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

// Lancement au chargement
$(document).ready(init);
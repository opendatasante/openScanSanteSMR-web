// js/map.js
import { state } from './state.js';
import { loadEstablishment } from './ui.js';

let map = null;
let markersLayer = null;
let legendControl = null;

export function initMap() {
    if (map) return;
    map = L.map('map-view', { zoomControl: true, scrollWheelZoom: true }).setView([46.6, 2.5], 6);
    L.tileLayer('https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 18
    }).addTo(map);

    markersLayer = L.featureGroup().addTo(map);
    addLegend(map);
}

export function refreshViews() {
    if (state.currentView !== "map" || !state.table) return;

    const filteredData = state.table.rows({ filter: 'applied' }).data().toArray();
    const filteredFiness = filteredData.map(r => r[0]);

    const filteredSites = {};
    filteredFiness.forEach(f => { filteredSites[f] = state.mapping[f]; });

    updateMapMarkers(filteredSites);

    const noFilter = !document.getElementById('filter-region').value &&
        !document.getElementById('filter-dept').value &&
        !document.getElementById('filter-sector').value;

    const filteredDepts = new Set(filteredFiness.map(f => String(state.mapping[f].dep_code)));

    if (noFilter) {
        map.setView([46.6, 2.5], 6);
        return;
    }

    if (filteredDepts.size === 1) {
        const f = filteredFiness[0];
        const s = state.mapping[f];
        const { lat, lon } = projectDOMCoordinates(s.latitude, s.longitude, String(s.dep_code));
        map.setView([lat, lon], 9);
        return;
    }

    fitMapToMarkers();
}

function updateMapMarkers(sites) {
    markersLayer.clearLayers();
    Object.entries(sites).forEach(([finess, s]) => {
        if (!state.mapping[finess] || !s.latitude || !s.longitude) return;

        const total = s.total_journees || 0;
        const radius = Math.max(3, Math.sqrt(total) * 0.05);
        const isPrivate = (s.categorie || "").toUpperCase().includes("PRIV");
        const color = isPrivate ? "#ff6b6b" : "#4dabf7";

        const { lat, lon } = projectDOMCoordinates(s.latitude, s.longitude, String(s.dep_code));
        const marker = L.circleMarker([lat, lon], {
            radius, fillColor: color, color, weight: 1, fillOpacity: 0.55
        }).addTo(markersLayer);

        marker.on("click", () => loadEstablishment(finess));
        marker.bindPopup(`
            <strong>${s.raison_sociale}</strong><br>
            ${s.dep_name} (${s.dep_code})<br>
            ${s.categorie}<br>
            <span style="color:#888">Journées : ${total.toLocaleString()}</span>
        `);
    });
}

function fitMapToMarkers() {
    const bounds = markersLayer.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30] });
}

function projectDOMCoordinates(lat, lon, depCode) {
    switch (depCode) {
        case "971": return { lat: 43.5, lon: -6.0 };
        case "972": return { lat: 43.0, lon: -6.0 };
        case "973": return { lat: 42.5, lon: -6.0 };
        case "974": return { lat: 43.0, lon: 10.0 };
        case "976": return { lat: 42.5, lon: 10.0 };
        default: return { lat, lon };
    }
}

function addLegend(map) {
    if (legendControl) return;

    legendControl = L.control({ position: "bottomright" });

    legendControl.onAdd = function () {
        const div = L.DomUtil.create("div", "info legend");

        const sizes = [
            { label: "< 10 000 journées", value: 10000 },
            { label: "10 000 – 30 000", value: 30000 },
            { label: "> 30 000", value: 50000 }
        ];

        const sectors = [
            { label: "Public", color: "#4dabf7" },
            { label: "Privé", color: "#ff6b6b" }
        ];

        div.innerHTML = `<div class="legend-title">Volume d'activité</div>`;

        sizes.forEach(s => {
            const r = Math.sqrt(s.value) * 0.05;
            const size = r * 2;

            div.innerHTML += `
                <div class="legend-item">
                    <svg width="${size}" height="${size}">
                        <circle cx="${r}" cy="${r}" r="${r}"
                            fill="#4dabf7" fill-opacity="0.5"
                            stroke="#4dabf7" stroke-width="1"></circle>
                    </svg>
                    <span>${s.label}</span>
                </div>
            `;
        });

        div.innerHTML += `<div class="legend-subtitle">Secteur</div>`;

        sectors.forEach(sec => {
            div.innerHTML += `
                <div class="legend-item">
                    <div style="
                        width: 14px;
                        height: 14px;
                        border-radius: 50%;
                        background: ${sec.color};
                        margin-right: 8px;
                        border: 1px solid #333;
                    "></div>
                    <span>${sec.label}</span>
                </div>
            `;
        });

        return div;
    };

    legendControl.addTo(map);
}
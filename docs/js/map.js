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
    const filteredFiness = filteredData.map(r => r[1]);

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

// Dans js/map.js
function updateMapMarkers(sites) {
    markersLayer.clearLayers();

    Object.entries(sites).forEach(([finess, s]) => {
        if (!state.mapping[finess] || !s.latitude || !s.longitude) return;

        let total = 0;

        // C'EST ICI QUE TOUT CHANGE :
        if (state.mapCustomData !== null) {
            total = state.mapCustomData[finess] || 0;
            // Magique : Si l'hôpital n'a pas d'activité dans cette catégorie, on le masque !
            if (total === 0) return;
        } else {
            total = s.total_journees || 0;
        }

        // On ajuste le coefficient pour que les bulles des petits GME restent visibles
        //const multiplier = state.mapCustomData !== null ? 0.15 : 0.05;
        const multiplier = 0.05;
        const radius = Math.max(4, Math.sqrt(total) * multiplier);

        const isPrivate = (s.categorie || "").toUpperCase().includes("PRIV");
        const color = isPrivate ? "#ff6b6b" : "#4dabf7";

        const { lat, lon } = projectDOMCoordinates(s.latitude, s.longitude, String(s.dep_code));
        const marker = L.circleMarker([lat, lon], {
            radius,
            fillColor: color,
            color,
            weight: 1,
            fillOpacity: 0.55
        }).addTo(markersLayer);

        marker.on("click", () => {
            import('./ui.js').then(module => module.loadEstablishment(finess));
        });

        marker.bindPopup(`
            <strong>${s.raison_sociale}</strong><br>
            ${s.dep_name} (${s.dep_code})<br>
            ${s.categorie}<br>
            <span style="color:#888">Journées (Critère) : ${total.toLocaleString()}</span>
        `);
    });
}

function fitMapToMarkers() {
    const bounds = markersLayer.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30] });
}

function projectDOMCoordinates(lat, lon, depCode) {
    return { lat, lon };
    // 1. S'assurer que l'on manipule bien des nombres
    const l_lat = parseFloat(lat);
    const l_lon = parseFloat(lon);

    // Sécurité si les coordonnées sont absentes
    if (isNaN(l_lat) || isNaN(l_lon)) return { lat, lon };

    // 2. Appliquer un décalage (offset) pour rapprocher les DOM de la métropole
    // Centre de la France : ~ Lat 46.0, Lon 2.0
    switch (depCode) {
        case "9A": // Guadeloupe (On la place à l'Ouest, dans l'océan Atlantique)
            return { lat: l_lat + 29.7, lon: l_lon + 53.5 };

        case "9B": // Martinique (Juste en dessous de la Guadeloupe)
            return { lat: l_lat + 29.8, lon: l_lon + 53.0 };

        case "9C": // Guyane (Encore en dessous, Sud-Ouest)
            return { lat: l_lat + 38.5, lon: l_lon + 45.1 };

        case "9D": // La Réunion (On la place à l'Est, sous la Corse)
            return { lat: l_lat + 62.6, lon: l_lon - 45.5 };

        case "9F": // Mayotte (Juste au-dessus de la Réunion)
            return { lat: l_lat + 55.8, lon: l_lon - 35.1 };

        default:
            // Pour la métropole, on ne change rien
            return { lat: l_lat, lon: l_lon };
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
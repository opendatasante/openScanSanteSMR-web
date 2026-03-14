// js/map.js
import { state } from './state.js';
import { loadEstablishment } from './ui_details.js';

let map = null;
let markersLayer = null;
let legendControl = null;

// Nouveaux calques et gestion d'état
let domBackgroundsLayer = null;
let osmTileLayer = null;
let isCartogramMode = true; // True = Mode INSEE (par défaut), False = Mode OSM réel

export function initMap() {
    if (map) return;

    map = L.map('map-view', { zoomControl: true, scrollWheelZoom: true }).setView([46.6, 2.5], 6);

    // 1. Préparation du fond OSM (Carte réelle)
    osmTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 18
    });

    // 2. Préparation du fond INSEE (Profondeur)
    map.createPane('fondDeCarte');
    map.getPane('fondDeCarte').style.zIndex = 390;
    map.getPane('fondDeCarte').style.pointerEvents = 'none';

    domBackgroundsLayer = L.featureGroup();
    markersLayer = L.featureGroup().addTo(map);

    // 3. Charger les contours GeoJSON en mémoire
    loadMapBackgrounds();

    // 4. Ajouter les contrôles UI
    addModeToggleControl(map);
    addLegend(map);

    // 5. Appliquer le mode par défaut (INSEE)
    applyMapMode();
}

// Nouvelle fonction pour basculer visuellement entre les deux modes
function applyMapMode() {
    if (isCartogramMode) {
        // --- MODE INSEE ---
        document.getElementById('map-view').style.background = '#ffffff';
        if (map.hasLayer(osmTileLayer)) map.removeLayer(osmTileLayer);
        if (!map.hasLayer(domBackgroundsLayer)) map.addLayer(domBackgroundsLayer);
    } else {
        // --- MODE OSM ---
        document.getElementById('map-view').style.background = '#e5e5e5'; // Gris par défaut Leaflet
        if (map.hasLayer(domBackgroundsLayer)) map.removeLayer(domBackgroundsLayer);
        if (!map.hasLayer(osmTileLayer)) map.addLayer(osmTileLayer);
    }

    // On force le redessin de toutes les bulles pour qu'elles se placent aux bonnes coordonnées
    refreshViews();
}

// Création d'un bouton (interrupteur) sur la carte pour changer de mode
function addModeToggleControl(map) {
    const toggleControl = L.control({ position: 'topright' });

    toggleControl.onAdd = function () {
        const div = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom');
        div.style.backgroundColor = 'white';
        div.style.padding = '8px 12px';
        div.style.cursor = 'pointer';
        div.style.boxShadow = '0 1px 5px rgba(0,0,0,0.65)';
        div.style.borderRadius = '4px';

        div.innerHTML = `
            <label style="cursor:pointer; margin:0; font-weight:bold; font-size:13px; color:#333; display:flex; align-items:center; gap:8px;">
                <input type="checkbox" id="mode-toggle" ${isCartogramMode ? 'checked' : ''} style="cursor:pointer; width:16px; height:16px;">
                Vue regroupée (sans carte)
            </label>
        `;

        // Empêcher le clic de se propager à la carte en dessous
        div.onclick = function (e) { e.stopPropagation(); };
        div.ondblclick = function (e) { e.stopPropagation(); };

        // Écouter le changement
        div.querySelector('#mode-toggle').addEventListener('change', function (e) {
            isCartogramMode = e.target.checked;
            applyMapMode();
        });

        return div;
    };

    toggleControl.addTo(map);
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
        // Le centrage sera automatiquement correct selon le mode choisi !
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

        let total = 0;
        let statObj = null; // On prépare une variable pour stocker les infos du secret

        const entry = state.mapCustomData?.[finess];

        if (entry) {
            total = entry.val ?? 0;
            statObj = entry.stat; // Ajouté dans api.js (contient min, max, isExact)
            if (total === 0) return;
        } else {
            total = s.total_journees ?? 0;
            statObj = s.stat_total; // Ajouté dans api.js
        }

        const multiplier = 0.05;
        const radius = Math.max(4, Math.sqrt(total) * multiplier);

        const isPrivate = (s.categorie || "").toUpperCase().includes("PRIV");
        const color = isPrivate ? "#ff6b6b" : "#4dabf7";

        // Coordonnées réelles OU modifiées selon le mode actif
        const { lat, lon } = projectDOMCoordinates(s.latitude, s.longitude, String(s.dep_code));

        const marker = L.circleMarker([lat, lon], {
            radius,
            fillColor: color,
            color,
            weight: 1,
            fillOpacity: 0.55
        }).addTo(markersLayer);

        marker.on("click", () => {
            loadEstablishment(finess);
        });

        // Formatage intelligent pour la Popup (gestion du cadenas)
        let popupText = `${total.toLocaleString()} j.`;
        if (statObj) {
            if (statObj.isExact) {
                popupText = `${statObj.min.toLocaleString()} j.`;
            } else {
                // Si c'est masqué, on affiche l'intervalle avec le petit cadenas
                popupText = statObj.min === 1 && statObj.max === 10
                    ? `1 à 10 j. 🔒`
                    : `${statObj.min.toLocaleString()} à ${statObj.max.toLocaleString()} j. 🔒`;
            }
        }

        marker.bindPopup(`
            <strong>${s.raison_sociale}</strong><br>
            ${s.dep_name} (${s.dep_code})<br>
            ${s.categorie}<br>
            <span style="color:#888">Activité : ${popupText}</span>
        `);
    });
}

function fitMapToMarkers() {
    const bounds = markersLayer.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30] });
}


async function loadMapBackgrounds() {
    // 1. FRANCE MÉTROPOLITAINE (Contours améliorés)
    try {
        //const resMetro = await fetch("https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/departements-version-simplifiee.geojson");
        const resMetro = await fetch("https://cdn.jsdelivr.net/gh/gregoiredavid/france-geojson/departements-version-simplifiee.geojson");
        const dataMetro = await resMetro.json();

        dataMetro.features = dataMetro.features.filter(f => !f.properties.code.startsWith("97"));

        L.geoJSON(dataMetro, {
            pane: 'fondDeCarte',
            style: {
                color: "#ffffff",     // Bordure très blanche
                weight: 1.5,          // Un peu plus épaisse pour bien séparer les départements
                fillColor: "#dee2e6", // Gris très légèrement plus dense pour mieux contraster
                fillOpacity: 1
            }
        }).addTo(domBackgroundsLayer);

    } catch (err) {
        console.error("Erreur métropole", err);
    }

    // 2. DOM-TOM
    //const doms = [
    //    { code: "971", name: "Guadeloupe", url: "https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/departements/971-guadeloupe/departement-971-guadeloupe.geojson" },
    //    { code: "972", name: "Martinique", url: "https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/departements/972-martinique/departement-972-martinique.geojson" },
    //    { code: "973", name: "Guyane", url: "https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/departements/973-guyane/departement-973-guyane.geojson" },
    //    { code: "974", name: "La Réunion", url: "https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/departements/974-la-reunion/departement-974-la-reunion.geojson" },
    //    { code: "976", name: "Mayotte", url: "https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/departements/976-mayotte/departement-976-mayotte.geojson" }
    //];
    const doms = [
        { code: "971", name: "Guadeloupe", url: "https://cdn.jsdelivr.net/gh/gregoiredavid/france-geojson/departements/971-guadeloupe/departement-971-guadeloupe.geojson" },
        { code: "972", name: "Martinique", url: "https://cdn.jsdelivr.net/gh/gregoiredavid/france-geojson/departements/972-martinique/departement-972-martinique.geojson" },
        { code: "973", name: "Guyane", url: "https://cdn.jsdelivr.net/gh/gregoiredavid/france-geojson/departements/973-guyane/departement-973-guyane.geojson" },
        { code: "974", name: "La Réunion", url: "https://cdn.jsdelivr.net/gh/gregoiredavid/france-geojson/departements/974-la-reunion/departement-974-la-reunion.geojson" },
        { code: "976", name: "Mayotte", url: "https://cdn.jsdelivr.net/gh/gregoiredavid/france-geojson/departements/976-mayotte/departement-976-mayotte.geojson" }
    ];

    for (const dom of doms) {
        try {
            const response = await fetch(dom.url);
            const data = await response.json();

            // Carte de l'île
            const layer = L.geoJSON(data, {
                pane: 'fondDeCarte',
                coordsToLatLng: function (coords) {
                    // Ici on simule que l'isCartogramMode est true pour que le fond se dessine bien à l'endroit désiré
                    // Même si on décoche, ce calque sera juste caché, il ne se redessinera pas
                    const projected = projectDOMCoordinatesForce(coords[1], coords[0], dom.code);
                    return new L.LatLng(projected.lat, projected.lon);
                },
                style: {
                    color: "#ffffff",
                    weight: 1.5,
                    fillColor: "#dee2e6",
                    fillOpacity: 1
                }
            }).addTo(domBackgroundsLayer);

            // Boîte autour
            const bounds = layer.getBounds();
            L.rectangle(bounds.pad(0.15), {
                pane: 'fondDeCarte',
                color: "#6c757d", // Gris un peu plus foncé pour la boîte
                weight: 1.5,
                fill: false,
                dashArray: "3, 4" // Lignes pointillées plus esthétiques
            }).addTo(domBackgroundsLayer);

            // Nom de l'île
            const southWest = bounds.pad(0.15).getSouthWest();
            L.marker([southWest.lat, bounds.getCenter().lng], {
                icon: L.divIcon({
                    className: 'dom-label',
                    html: `<div style="text-align:center; font-weight:600; color:#495057; font-size:11px; margin-top: 5px;">${dom.name}</div>`,
                    iconSize: [100, 20],
                    iconAnchor: [50, 0]
                }),
                interactive: false
            }).addTo(domBackgroundsLayer);

        } catch (err) {
            console.error("Erreur DOM : " + dom.name, err);
        }
    }
}


// --- LES DEUX FONCTIONS DE CALCUL DES COORDONNÉES ---

// 1. Fonction utilisée par le dessinateur de fond de carte (Force le décalage)
function projectDOMCoordinatesForce(lat, lon, depCode) {
    const l_lat = parseFloat(lat);
    const l_lon = parseFloat(lon);
    if (isNaN(l_lat) || isNaN(l_lon)) return { lat, lon };

    const code = String(depCode).toUpperCase();

    if (code === "971" || code === "9A") return { lat: l_lat + 33.0, lon: l_lon + 55.0 };
    if (code === "972" || code === "9B") return { lat: l_lat + 33.0, lon: l_lon + 54.5 };
    if (code === "976" || code === "9F") return { lat: l_lat + 58.8, lon: l_lon - 51.6 };
    if (code === "974" || code === "9D") return { lat: l_lat + 65.5, lon: l_lon - 62.0 };
    if (code === "973" || code === "9C") return { lat: l_lat + 42.0, lon: l_lon + 64.0 };

    return { lat: l_lat, lon: l_lon };
}

// 2. Fonction utilisée par les bulles (Dépend de la case à cocher)
function projectDOMCoordinates(lat, lon, depCode) {
    // Si l'utilisateur a décoché la vue statistique, on renvoie les vraies coordonnées !
    if (!isCartogramMode) {
        return { lat: parseFloat(lat), lon: parseFloat(lon) };
    }

    // Sinon on applique le décalage cartographique
    return projectDOMCoordinatesForce(lat, lon, depCode);
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

        div.innerHTML = `<div class="legend-title" style="margin-bottom:8px; font-weight:bold;">Volume d'activité</div>`;

        sizes.forEach(s => {
            const r = Math.sqrt(s.value) * 0.05;
            const size = r * 2;

            div.innerHTML += `
                <div class="legend-item" style="display:flex; align-items:center; margin-bottom:4px;">
                    <div style="width:24px; text-align:center; margin-right:8px;">
                        <svg width="${size}" height="${size}" style="overflow:visible;">
                            <circle cx="${r}" cy="${r}" r="${r}"
                                fill="#4dabf7" fill-opacity="0.5"
                                stroke="#4dabf7" stroke-width="1"></circle>
                        </svg>
                    </div>
                    <span style="font-size:12px;">${s.label}</span>
                </div>
            `;
        });

        div.innerHTML += `<div class="legend-subtitle" style="margin:12px 0 8px 0; font-weight:bold;">Secteur</div>`;

        sectors.forEach(sec => {
            div.innerHTML += `
                <div class="legend-item" style="display:flex; align-items:center; margin-bottom:4px;">
                    <div style="
                        width: 14px;
                        height: 14px;
                        border-radius: 50%;
                        background: ${sec.color};
                        margin-right: 12px;
                        margin-left: 5px;
                        border: 1px solid #333;
                    "></div>
                    <span style="font-size:12px;">${sec.label}</span>
                </div>
            `;
        });

        // J'ajoute un petit style CSS global pour la légende pour faire propre
        div.style.backgroundColor = 'rgba(255, 255, 255, 0.9)';
        div.style.padding = '10px 15px';
        div.style.borderRadius = '5px';
        div.style.boxShadow = '0 1px 5px rgba(0,0,0,0.4)';
        div.style.lineHeight = '1.2';

        return div;
    };

    legendControl.addTo(map);
}
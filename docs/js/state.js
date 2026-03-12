// js/state.js
export const state = {
    mapping: {},
    officialTotals: {},
    catMajLabels: {},
    gnLabels: {},
    gmeLabels: {},
    table: null,
    currentView: "list",
    globalMetrics: {},
    optionsTree: [],
    mapCustomData: null,
    selectedFiness: []
};

export const config = {
    dataBaseUrl: 'https://cdn.jsdelivr.net/gh/opendatasante/openScanSanteSMR-web@main/data',
    cdnPrefix: 'https://cdn.jsdelivr.net/gh/sebastiencys/openScanSanteSMR-data/',
    indexUrl: 'https://cdn.jsdelivr.net/gh/sebastiencys/openScanSanteSMR-data/data-index.json',
    releaseUrl: 'https://cdn.jsdelivr.net/gh/sebastiencys/openScanSanteSMR-data/release-latest.json'
};
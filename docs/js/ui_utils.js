// js/ui_utils.js

/**
 * Parse a statistical value (can be an exact number, a range like '1 à 10', or NA)
 * @param {string|number} val 
 * @returns {object} { min, max, isExact, mid }
 */
export function parseDays(val) {
    if (val === undefined || val === null || val === "NA" || val === "N/A" || val === "") {
        return { min: 0, max: 0, isExact: true, mid: 0 };
    }
    if (val === "1 à 10" || val === "< 11") {
        return { min: 1, max: 10, isExact: false, mid: 5.5 };
    }
    const num = parseInt(val) || 0;
    return { min: num, max: num, isExact: true, mid: num };
}

/**
 * Add two statistical objects
 * @param {object} s1 { min, max, isExact, mid }
 * @param {object} s2 { min, max, isExact, mid }
 * @returns {object} Summarized stat
 */
export function addStats(s1, s2) {
    return {
        min: s1.min + s2.min,
        max: s1.max + s2.max,
        isExact: s1.isExact && s2.isExact,
        mid: s1.mid + s2.mid
    };
}

/**
 * Formats a stat for display, handling uncertainty (lock icon)
 * @param {object} stat { min, max, isExact, mid }
 * @param {string} unit e.g. "j."
 * @returns {string} Formatted HTML string
 */
export function formatStat(stat, unit = "j.") {
    const u = unit ? ` ${unit.trim()}` : '';
    if (stat.isExact) return `${stat.min.toLocaleString()}${u}`;

    const icon = `<span title="Inclut des données soumises au secret statistique (< 11)" style="cursor:help; font-size: 0.9em; margin-left:3px; filter: grayscale(1); opacity: 0.8;">🔒</span>`;
    if (stat.min === 1 && stat.max === 10) return `1 à 10${u} ${icon}`;
    return `${stat.min.toLocaleString()} à ${stat.max.toLocaleString()}${u} ${icon}`;
}

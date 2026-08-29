/* Glance icons — monochrome line glyphs drawn in currentColor, sized by CSS.
   Kept intentionally simple so they read at ~16-18px. Consumed by app.js
   (classifyIcon / iconEl). Loaded as a plain script -> window.ICONS. */
(function () {
  "use strict";
  var W = function (inner) {
    return (
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      inner +
      "</svg>"
    );
  };

  window.ICONS = {
    // --- sports ---
    nfl: W('<path d="M3 12c2.5-4.2 6-6.2 9-6.2s6.5 2 9 6.2c-2.5 4.2-6 6.2-9 6.2S5.5 16.2 3 12Z"/><path d="M9.3 12h5.4M12 10.3v3.4M9.9 11v2M14.1 11v2"/>'),
    nba: W('<circle cx="12" cy="12" r="8.6"/><path d="M3.4 12h17.2M12 3.4v17.2M6 5.6c3 2.6 3 10.2 0 12.8M18 5.6c-3 2.6-3 10.2 0 12.8"/>'),
    mlb: W('<circle cx="12" cy="12" r="8.6"/><path d="M7 4.8c2 3.3 2 11.1 0 14.4M17 4.8c-2 3.3-2 11.1 0 14.4"/>'),
    nhl: W('<ellipse cx="12" cy="8.5" rx="8" ry="3"/><path d="M4 8.5v6.5c0 1.7 3.6 3 8 3s8-1.3 8-3V8.5"/>'),
    soccer: W('<circle cx="12" cy="12" r="8.6"/><path d="M12 7.6l3.8 2.8-1.5 4.4H9.7L8.2 10.4Z"/><path d="M12 3.4v4.2M4.3 9.6l3.9 0.8M19.7 9.6l-3.9 0.8M7 19l2.7-3.6M17 19l-2.7-3.6"/>'),
    trophy: W('<path d="M8 4h8v4.5a4 4 0 0 1-8 0Z"/><path d="M8 5.2H5v2a3 3 0 0 0 3 3M16 5.2h3v2a3 3 0 0 1-3 3M10 12.6V16M14 12.6V16M8.5 20h7M9.5 20c0-1.9 1.1-3.4 2.5-3.4s2.5 1.5 2.5 3.4"/>'),

    // --- politics ---
    flag: W('<path d="M6 3v18"/><path d="M6 4h13l-3 4.2 3 4.2H6"/>'),
    capitol: W('<path d="M12 3.2c2 1.1 3.2 3.1 3.2 5.3H8.8C8.8 6.3 10 4.3 12 3.2ZM12 2.6v.6M4 13.5h16M4.8 20h14.4M6.5 13.5V20M9.5 13.5V20M12 13.5V20M14.5 13.5V20M17.5 13.5V20M3.6 20h16.8"/>'),
    ballot: W('<rect x="3.5" y="9" width="17" height="11.2" rx="1"/><path d="M8.6 9l1.5-4.2h3.8L18 9M9 14.6l2 2 3.6-4.2"/>'),
    scales: W('<path d="M12 3.6v16.8M7.5 20.4h9M5 8.4h14M5 8.4l-2.4 4.8a3 3 0 0 0 6 0L6 8.4M19 8.4l-2.4 4.8a3 3 0 0 0 6 0L20 8.4"/>'),

    // --- economics ---
    bank: W('<path d="M3.2 9L12 3.8 20.8 9M4 9h16M4 20h16M6.4 9v9M10.1 9v9M13.9 9v9M17.6 9v9"/>'),
    chart: W('<path d="M3.5 20h17M6.5 20v-6.5M11.5 20V8M16.5 20v-9.5"/>'),

    // --- crypto ---
    bitcoin: W('<circle cx="12" cy="12" r="8.6"/><path d="M9.3 7.6h4.4a2.1 2.1 0 0 1 0 4.2H9.3zM9.3 11.8h4.9a2.1 2.1 0 0 1 0 4.2H9.3zM9.3 7.6V5.6M9.3 18.4v-2M12.1 5.6v2M12.1 16.4v2"/>'),
    ethereum: W('<path d="M12 3.2l6 9-6 3.2-6-3.2Z"/><path d="M6 13.4l6 7.4 6-7.4-6 3.2Z"/>'),
    coin: W('<circle cx="12" cy="12" r="8.6"/><path d="M12 6.6v10.8M14.8 9C14 8.1 13 7.7 12 7.7c-1.8 0-3.2 1-3.2 2.4 0 3.1 6.4 1.8 6.4 4.6 0 1.4-1.4 2.4-3.2 2.4-1 0-2-.4-2.8-1.3"/>'),

    // --- world / geopolitics ---
    globe: W('<circle cx="12" cy="12" r="8.6"/><path d="M3.4 12h17.2M12 3.4c3 2.7 3 15.2 0 17.2M12 3.4c-3 2.7-3 15.2 0 17.2"/>'),

    // --- entertainment ---
    film: W('<rect x="3.4" y="5" width="17.2" height="14" rx="1"/><path d="M7.4 5v14M16.6 5v14M3.4 9.7h4M16.6 9.7h4M3.4 14.3h4M16.6 14.3h4"/>'),
    mic: W('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6"/>'),
    award: W('<circle cx="12" cy="15" r="5"/><path d="M9.2 10.4 6 3M14.8 10.4 18 3M10.4 15l1.2 1.2 2.4-3"/>'),

    // --- science / climate ---
    flame: W('<path d="M12 3.2c1.1 4 5 5.2 5 9.2a5 5 0 0 1-10 0c0-2 1-3.2 2-4.2 0 2 1 3 2 3 0-3-1-4.2-1-8Z"/>'),
    rocket: W('<path d="M12 3.2c3 2.1 5 6.2 5 10.3l-2 3H9l-2-3c0-4.1 2-8.2 5-10.3ZM12 12.4a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2ZM9 17l-2 4M15 17l2 4"/>'),
    atom: W('<circle cx="12" cy="12" r="1.9"/><ellipse cx="12" cy="12" rx="9" ry="3.8"/><ellipse cx="12" cy="12" rx="9" ry="3.8" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="3.8" transform="rotate(120 12 12)"/>'),

    // --- generic fallback ---
    dot: W('<circle cx="12" cy="12" r="3.4"/><path d="M12 4v3M12 17v3M4 12h3M17 12h3"/>'),
  };
})();

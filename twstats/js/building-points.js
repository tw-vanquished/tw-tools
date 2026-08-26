/* Tribal Wars building points-per-level, from the ES wiki 'Tabla de puntuación'.
   BP[i] = {n: building name, p: [points added at level 1, 2, ...]} (null = no such level).
   Used by village.js 'Posibles mejoras': a points jump D => every (building, level)
   whose p[level-1] === D is a candidate. Classic script; exposes TW.BUILDING_POINTS. */
(function () {
  "use strict";
  if (!window.TW) window.TW = {};
  var TW = window.TW;
  TW.BUILDING_POINTS = [{"n": "Edificio Principal", "p": [10, 2, 2, 3, 4, 4, 5, 6, 7, 9, 10, 12, 15, 18, 21, 26, 31, 37, 44, 53, 64, 77, 92, 110, 133, 159, 191, 229, 274, 330]}, {"n": "Cuartel", "p": [16, 3, 4, 5, 5, 7, 8, 9, 12, 14, 16, 20, 24, 28, 34, 42, 49, 59, 71, 85, 102, 123, 147, 177, 212, null, null, null, null, null]}, {"n": "Cuadra", "p": [20, 4, 5, 6, 6, 9, 10, 12, 14, 17, 21, 25, 29, 36, 43, 51, 62, 74, 88, 107, null, null, null, null, null, null, null, null, null, null]}, {"n": "Taller", "p": [24, 5, 6, 6, 9, 10, 12, 14, 17, 21, 25, 29, 36, 43, 51, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null]}, {"n": "Corte", "p": [512, 102, 123, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null]}, {"n": "Herrería", "p": [19, 4, 4, 6, 6, 8, 10, 11, 14, 16, 20, 23, 28, 34, 41, 49, 58, 71, 84, 101, null, null, null, null, null, null, null, null, null, null]}, {"n": "Plaza de Reuniones", "p": [0, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null]}, {"n": "Estatua", "p": [24, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null]}, {"n": "Plaza de Mercado", "p": [10, 2, 2, 3, 4, 4, 5, 6, 7, 9, 10, 12, 15, 18, 21, 26, 31, 37, 44, 53, 64, 77, 92, 110, 133, null, null, null, null, null]}, {"n": "Leñador", "p": [6, 1, 2, 1, 2, 3, 3, 3, 5, 5, 6, 8, 8, 11, 13, 15, 19, 22, 27, 32, 38, 46, 55, 66, 80, 95, 115, 137, 165, 198]}, {"n": "Barrera", "p": [6, 1, 2, 1, 2, 3, 3, 3, 5, 5, 6, 8, 8, 11, 13, 15, 19, 22, 27, 32, 38, 46, 55, 66, 80, 95, 115, 137, 165, 198]}, {"n": "Mina de Hierro", "p": [6, 1, 2, 1, 2, 3, 3, 3, 5, 5, 6, 8, 8, 11, 13, 15, 19, 22, 27, 32, 38, 46, 55, 66, 80, 95, 115, 137, 165, 198]}, {"n": "Granja", "p": [5, 1, 1, 2, 1, 2, 3, 3, 3, 5, 5, 6, 8, 8, 11, 13, 15, 19, 22, 27, 32, 38, 46, 55, 66, 80, 95, 115, 137, 165]}, {"n": "Almacén", "p": [6, 1, 2, 1, 2, 3, 3, 3, 5, 5, 6, 8, 8, 11, 13, 15, 19, 22, 27, 32, 38, 46, 55, 66, 80, 95, 115, 137, 165, 198]}, {"n": "Escondrijo", "p": [5, 1, 1, 2, 1, 2, 3, 3, 3, 5, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null]}, {"n": "Muralla", "p": [8, 2, 2, 2, 3, 3, 4, 5, 5, 7, 9, 9, 12, 15, 17, 20, 25, 29, 36, 43, null, null, null, null, null, null, null, null, null, null]}];
  // delta -> [{name, level}] candidate upgrades that add exactly `delta` points
  TW.mejoras = function (delta) {
    var out = [];
    for (var i = 0; i < TW.BUILDING_POINTS.length; i++) {
      var b = TW.BUILDING_POINTS[i];
      for (var L = 0; L < b.p.length; L++) {
        if (b.p[L] === delta) out.push({ name: b.n, level: L + 1 });
      }
    }
    return out;
  };
})();

## 🌐 Interface web de visualisation
Lancez le serveur local :
```bash
python -m http.server 8000
```
Explorez : http://localhost:8000/docs/index.html

## TODO
- pouvoir comparer plusieurs établissements (évolutions temporelles des séjours, indicateurs SMR globaux voire avec possibilité de choisir CM/GN/GME pour comparaison)
- amélioration de la récupération des stats (si 1 CM et pas de GN ni de GME récupérer directement les totaux du dossier parents et pas itérer, idem si 1 CM et 1 GN et pas de GME)
- gestion du secret statistique (intervalle de confiance, isInacurrate avec avertissement sur les jours d'hospit, les indicateurs, ...)
- carte façon INSEE avec DOM/TOM autour de la France métropolitaine
## 🌐 Interface web de visualisation
Lancez le serveur local :
```bash
python -m http.server 8000
```
Explorez : http://localhost:8000/docs/index.html

## TODO
- pouvoir comparer plusieurs établissements (évolutions temporelles des séjours, indicateurs SMR globaux voire avec possibilité de choisir CM/GN/GME pour comparaison)
- gestion de l'affichage des CM/GN/GME (code en doublon, vérifier si le label contient déjà le code et si oui ne pas l'afficher)
- amélioration de la récupération des stats (si 1 CM et pas de GN ni de GME récupérer directement les totaux du dossier parents et pas itérer, idem si 1 CM et 1 GN et pas de GME)
- barre de recherche non hiérarchique (possibilité de chercher directement sans différence CM/GN/GME, tout en pouvant récupérer ensuite ou lors de la sélection de la hiérarchie)
- gestion du secret statistique (intervalle de confiance, isInacurrate avec avertissement sur les jours d'hospit, les indicateurs, ...)

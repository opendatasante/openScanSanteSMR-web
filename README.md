## 🌐 Interface web de visualisation
Lancez le serveur local :
```bash
python -m http.server 8000
```
Explorez : http://localhost:8000/docs/index.html

## TODO
- données par CM/GN/GME semblent ok pour la carte mais pas pour les stats globales et la liste des établissements
- si sélection d'un CM/GN/GME, le panneau détails doit afficher les données de cette sélection (et non plus les données globales ou alors un rollup cachant les données globales et affichant les données de la sélection et inversement)
- pouvoir comparer plusieurs établissements (évolutions temporelles des séjours, indicateurs SMR globaux voire avec possibilité de choisir CM/GN/GME pour comparaison)

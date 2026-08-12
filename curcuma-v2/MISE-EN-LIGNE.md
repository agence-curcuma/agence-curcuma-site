# Mise en ligne — marche à suivre

Trois opérations, dans cet ordre. Compter une heure au total, plus le temps de propagation du DNS.

---

## 1. Le formulaire d'inscription — fait ✅

Le formulaire n'envoie plus vers MailerLite mais vers une application web Google
Apps Script qui écrit dans Google Sheets, tient le compte des 20 places, gère la
liste d'attente et envoie les e-mails.

L'URL du Web App est déjà raccordée dans `formations.html` (ligne ~823,
constante `GAS_ENDPOINT`). Le test de l'endpoint est passé.

**Toute l'exploitation au quotidien est décrite dans
[`apps-script/INSCRIPTIONS-mode-emploi.md`](apps-script/INSCRIPTIONS-mode-emploi.md)** :
structure de la feuille, procédures (annuler, libérer une place, marquer un
paiement, promouvoir depuis la liste d'attente) et plan de test en 15 points.

### Ce qu'il reste à faire ici

**Tester en vrai, une fois le site en ligne.** S'inscrire soi-même, puis vérifier :

- la ligne apparaît dans la feuille, en orange, statut `PLACE_RESERVEE_PAIEMENT_EN_ATTENTE` ;
- l'e-mail de paiement arrive, avec l'IBAN et le délai de 10 jours ;
- les colonnes « Entreprise » et « Attentes » sont bien remplies ;
- une notification t'est arrivée sur eve@agence-curcuma.ch ;
- le message de confirmation s'affiche bien sur la page.

Puis passer la ligne de test en `ANNULEE` (menu **Curcuma**) plutôt que la
supprimer — ça vérifie du même coup que la place est bien libérée.

### Si tu modifies le script plus tard

Toute modification de `Code.gs` exige un **Déployer ▸ Gérer les déploiements ▸
✏️ ▸ Version : Nouvelle version ▸ Déployer**. Sans cela l'ancienne version
continue de tourner. L'URL, elle, ne change pas — rien à retoucher côté site.

### Quand la session est complète

Rien à faire : au-delà de 20 places actives, le backend bascule automatiquement
les nouvelles demandes en liste d'attente, avec un écran et un e-mail dédiés.

Si tu veux fermer complètement le formulaire (session annulée, dates changées),
il reste l'interrupteur manuel : dans `formations.html`, chercher `full:false` et
passer à `full:true`. Le formulaire est alors remplacé par l'encart « Complet ».

---

## 2. Brancher le domaine — Infomaniak

### Le principe

Ton domaine et ton site sont deux choses séparées. Le domaine est l'adresse, GitHub est le bâtiment, le DNS est le panneau indicateur entre les deux. Aujourd'hui ce panneau n'existe pas.

### Dans le Manager Infomaniak

**Domaines** → `agence-curcuma.ch` → **Zone DNS**

**Commencer par supprimer** les enregistrements `A` existants sur `@` et l'éventuel `CNAME` sur `www` : ce sont ceux qu'Infomaniak crée par défaut vers son propre hébergement. S'ils restent, ils entrent en conflit.

Puis créer :

| Type | Source / Nom | Cible / Valeur | Rôle |
|---|---|---|---|
| CNAME | `www` | `TON-COMPTE.github.io.` | envoie `www.agence-curcuma.ch` vers GitHub |
| A | `@` | `185.199.108.153` | |
| A | `@` | `185.199.109.153` | redirigent le domaine nu |
| A | `@` | `185.199.110.153` | vers la version `www` |
| A | `@` | `185.199.111.153` | |

Remplacer `TON-COMPTE` par ton nom d'utilisateur GitHub. **Ne pas oublier le point final** après `.github.io.` — Infomaniak l'ajoute parfois tout seul, dans ce cas ne pas le doubler.

Les quatre enregistrements A ne sont pas facultatifs. Sans eux, quelqu'un qui tape `agence-curcuma.ch` sans le `www` tombe dans le vide, et surtout Google peut se retrouver avec deux adresses servant le même contenu — il n'en référence alors qu'une, choisie sans toi.

### Dans le dépôt GitHub

**Settings** → **Pages** :

1. **Source** : la branche qui contient le site (`main` en général), dossier `/ (root)`
2. **Custom domain** : saisir `www.agence-curcuma.ch` puis **Save**
3. Attendre que la vérification DNS passe au vert — de quelques minutes à 24 heures
4. Cocher alors **Enforce HTTPS** (la case n'est activable qu'une fois la vérification réussie)

Le fichier `CNAME` présent à la racine du projet contient déjà `www.agence-curcuma.ch` : GitHub le lit automatiquement, il ne faut ni le supprimer ni le renommer.

### Deux pièges à éviter

- **Publier le site à la racine du dépôt**, pas dans un sous-dossier. Les chemins des favicons et de la page 404 sont absolus (`/favicon.ico`) et casseraient depuis une adresse du type `compte.github.io/mon-repo/`.
- **Ne pas supprimer `.nojekyll`** : sans ce fichier, GitHub fait passer le site par son moteur Jekyll, ce qui peut faire disparaître certains fichiers.

### Vérifier une fois en ligne

Taper successivement dans le navigateur — les quatre doivent aboutir sur le site en `https://www` :

```
agence-curcuma.ch
www.agence-curcuma.ch
http://agence-curcuma.ch
http://www.agence-curcuma.ch
```

---

## 3. Une fois le site en ligne

### Le jour même

1. **Google Search Console** — <https://search.google.com/search-console> : ajouter la propriété `https://www.agence-curcuma.ch`, la valider (Infomaniak permet la validation par enregistrement TXT), puis soumettre `sitemap.xml` dans le menu Sitemaps.
2. **Tester les données structurées** : <https://search.google.com/test/rich-results>
3. **Tester l'aperçu de partage LinkedIn** : <https://www.linkedin.com/post-inspector/>

### Dans la semaine

4. **Créer la fiche Google Business Profile.** C'est le levier n°1 pour une agence locale — davantage que le site lui-même. Coordonnées à saisir **exactement** comme dans le pied de page :

   ```
   Agence Curcuma – Eve Schaller
   Sur le Bévan 11a
   2852 Courtételle
   +41 79 582 84 37
   ```

   Catégorie : « Agence de marketing ». Si tu ne reçois pas de clients chez toi, configurer une **zone desservie** plutôt qu'une adresse visible : Google vérifie l'adresse sans la rendre publique.

5. **Demander trois avis Google** à David Wahli, Olivier Léchenne et Manon Delisle. Leurs témoignages sont déjà sur le site ; les mêmes en avis Google pèsent bien plus lourd, parce qu'ils sont vérifiables.

### Ensuite

Voir les recommandations de contenu dans `SEO-avant-publication.md` — pages par prestation, études de cas, FAQ sur la formation.

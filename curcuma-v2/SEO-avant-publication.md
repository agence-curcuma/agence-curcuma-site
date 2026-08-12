# Audit SEO — site Agence Curcuma

Audit et corrections réalisés le 11 août 2026, avant mise en ligne sur `https://www.agence-curcuma.ch` (hébergement GitHub Pages).

**État : plus aucun marqueur à compléter. Le site est prêt à être publié**, sous réserve des trois points ci-dessous.

---

## Ce qu'il reste à faire

**→ Voir `MISE-EN-LIGNE.md`**, qui détaille pas à pas les trois opérations restantes :

1. **Raccorder le formulaire à MailerLite** — une seule adresse à coller dans `formations.html` (chercher `ADRESSE_MAILERLITE_A_COLLER`). Le reste du câblage est fait.
2. **Brancher le domaine** — zone DNS Infomaniak + réglages GitHub Pages, avec les valeurs exactes à recopier.
3. **Google Search Console et fiche Google Business Profile** — le levier n°1 pour une agence locale, davantage que le site lui-même.

---

## Ce qui a été corrigé

### Balises principales
- **Titres réécrits** : 79 et 71 caractères → 56 et 54. Au-delà de ~60, Google tronque. Les mots-clés réellement tapés (« marketing relationnel », « Suisse romande », « formation IA générative », « Delémont ») sont désormais en début de titre.
- **Méta-descriptions** recentrées sur ces mêmes termes, sous la limite d'affichage. Celle de la page Formations annonce le prix et les repas inclus : c'est ce qui fait cliquer depuis les résultats.
- **URL canonique** sur chaque page — évite le contenu dupliqué entre `www`/sans `www` et `http`/`https`.
- `lang="fr"` → `lang="fr-CH"` : signale le français de Suisse.
- Directive `robots` explicite avec `max-image-preview:large` (vignettes plus grandes dans les résultats).

### Partage social
- Balises **Open Graph** et **Twitter Card** complètes : sans elles, un lien partagé sur LinkedIn ou WhatsApp s'affiche en texte gris sans image.
- Création de `images/og-curcuma.png` (1200 × 630 px, aux couleurs de la charte).

### Favicon
- Créés : `favicon.ico`, `images/favicon.svg`, `images/apple-touch-icon.png`, `images/icon-512.png` — un « c » jaune sur fond bleu nuit. Il n'y en avait aucun : l'onglet du navigateur affichait une page blanche générique.

### Données structurées (JSON-LD)
- **Accueil** : `ProfessionalService` (raison sociale, adresse de Courtételle, téléphone, zones desservies, catalogue de prestations) + `Person` (Eve Schaller) + `WebSite` + `WebPage`.
- **Formations** : `Course` avec session datée (21–23 octobre 2026, Campus StrateJ, Delémont, 20 places, **CHF 1450.–**) + `BreadcrumbList`.
- Effet : Google peut afficher la formation avec ses dates, son lieu et son prix directement dans les résultats.

> *Note :* les témoignages n'ont volontairement pas été balisés en `Review`. Google ignore — et peut sanctionner — les avis qu'une entreprise publie sur elle-même dans son propre balisage. Ils gardent toute leur valeur de conversion sur la page ; pour le SEO, ce sont les avis Google qui comptent.

### Problème le plus grave : la page Formations était quasi vide pour Google
Tout le contenu (dates, lieu, programme des 3 jours) était injecté en JavaScript. Google exécute le JavaScript, mais avec retard et sans garantie — et les autres moteurs, les aperçus LinkedIn et les IA de recherche ne l'exécutent pas du tout.

Le programme complet est désormais écrit **en dur dans le HTML**, puis remplacé à l'identique par le script. Aucun changement visible pour le visiteur.

**Texte indexable de la page Formations : 253 mots → 692 mots.**

Une règle CSS `.no-js` garantit aussi que le programme reste entièrement déplié si le JavaScript ne s'exécute pas.

### Prix et prestations incluses
Ajoutés à quatre endroits, pour que l'information soit visible pour le lecteur **et** exploitable par Google :

- une pastille **CHF 1450.–** et une pastille **repas de midi et boissons inclus** dans les caractéristiques ;
- un bandeau tarifaire dans l'encart d'inscription (montant en jaune, mention « Inclus : les repas de midi, les boissons et les cafés pendant toute la durée de la formation ») ;
- la phrase d'introduction sous l'objectif ;
- le champ `offers` des données structurées (`price: 1450`, `priceCurrency: CHF`).

### Coordonnées et référencement local
- Bloc **NAP** (nom, adresse, téléphone) ajouté au pied de page d'accueil, en balise `<address>`, avec numéro cliquable. C'était l'absence la plus coûteuse : sans adresse, aucune chance d'apparaître sur « agence marketing Jura ».
- Les mêmes coordonnées sont reprises dans les données structurées et les mentions légales — cohérence exigée par Google.

### Performance et affichage
- `width`/`height` sur toutes les images : supprime le « saut » de mise en page pendant le chargement (**CLS**, l'un des trois signaux Core Web Vitals).
- `loading="lazy"` sur les images sous la ligne de flottaison, `fetchpriority="high"` sur le portrait d'accueil (probable élément LCP).
- Préchargement de la feuille de style des polices.
- Textes alternatifs enrichis.

### Fichiers d'indexation et pages manquantes
- `robots.txt` — absent jusqu'ici. Autorise explicitement les robots des IA génératives (GPTBot, PerplexityBot, ClaudeBot…) : de plus en plus de prospects passent par là. Un commentaire explique comment les bloquer si tu changes d'avis.
- `sitemap.xml` — les trois pages, avec dates de dernière modification.
- `404.html` — page d'erreur aux couleurs du site, en `noindex`, avec deux portes de sortie. GitHub Pages l'utilise automatiquement ; sans elle, un visiteur arrivant sur un lien mort voyait une page GitHub grise.
- `mentions-legales.html` — le formulaire d'inscription collecte des données personnelles, une page de confidentialité (nLPD/RGPD) est donc attendue. Elle mentionne l'hébergement chez GitHub, Inc. aux États-Unis et le transfert d'adresse IP que cela implique. C'est aussi un signal de fiabilité pour Google (critères E-E-A-T).
- Correction du lien mort « Voir la version principale » qui pointait vers la page elle-même.

### Correctifs divers
- Date de la formation : **octobre 2027 → octobre 2026**.
- Esperluettes non échappées dans les URL de polices (`&` → `&amp;`).
- `aria-live="polite"` retiré d'une section entière (faisait relire tout le bloc par les lecteurs d'écran à chaque changement).

**Vérification finale : 0 erreur de parsing HTML sur les quatre pages, données structurées valides, aucun lien interne cassé.**

---

## Recommandations non appliquées — à ta décision

### 1. Le H1 de l'accueil ne contient aucun mot-clé

> « Vous cherchez à intéresser un certain public ? Je vous permets de le rencontrer et de le toucher au cœur. »

Le H1 est le deuxième signal le plus fort après le titre. Celui-ci est excellent en persuasion et nul en référencement : personne ne tape ces mots dans Google.

Je n'y ai pas touché — c'est ton positionnement, pas une variable technique. Deux options si tu veux récupérer ce signal sans abîmer l'accroche :

- **Option prudente** : modifier le sur-titre juste au-dessus, aujourd'hui « Stratégie de croissance par le lien humain », en **« Marketing relationnel · Jura & Suisse romande »**. Le H1 émotionnel reste intact.
- **Option assumée** : « Vous cherchez à intéresser un certain public ? Je vous permets de le **rencontrer** — marketing relationnel en Suisse romande. »

### 2. Il manque des pages pour se positionner
Deux pages ne permettent de viser que deux requêtes. Chaque page supplémentaire est une porte d'entrée. Par ordre de rentabilité :

1. **Une page par prestation** (stratégie relationnelle, activation de réseau local, étude terrain) — les gens cherchent un service, pas une méthode.
2. **Des études de cas** (La Mobilière, Raiffeisen, Énergie du Jura) : le contenu le plus convertissant et le plus facile à référencer, parce qu'il est unique.
3. **Une page « Agence marketing dans le Jura »** si tu veux réellement occuper le terrain local.

### 3. Compléments utiles
- Une **FAQ** sur la page Formations (financement, annulation, matériel à apporter, facturation) balisée en `FAQPage` : gagne de la place dans les résultats et lève les objections avant l'inscription.
- **Compresser les images en WebP** : environ 60 % de poids en moins à qualité identique.
- Les polices Google sont chargées depuis les serveurs de Google (transmission de l'IP du visiteur). Les héberger en local règle à la fois la question de la confidentialité et un peu de vitesse.
- **Prévoir la suite de la session d'octobre** : quand elle sera passée, ne pas supprimer la page — remplacer la session par la suivante. Une URL qui accumule de l'ancienneté se référence bien mieux qu'une page recréée à chaque édition.

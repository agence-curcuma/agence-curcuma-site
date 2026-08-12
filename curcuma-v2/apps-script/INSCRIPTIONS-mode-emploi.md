# Inscriptions formation — mode d'emploi

Système : formulaire `formations.html` → Google Apps Script → Google Sheets.
Aucun serveur, aucun abonnement, aucune dépendance externe.

---

## 1. Ce qui a changé dans `formations.html`

| Section | Ligne (approx.) | Modification |
|---|---|---|
| Commentaire du formulaire | ~562 | MailerLite → Apps Script |
| Balise `<form>` | ~578 | `target="ml-sink"` et `action="ADRESSE_MAILERLITE…"` supprimés |
| 5 champs de saisie | ~580-584 | `name="fields[…]"` → `prenom`, `nom`, `email`, `entreprise`, `attentes` |
| Case CG | ~593 | `fields[cgv]` → `consentement` |
| Case newsletter | ~602 | `fields[newsletter]` → `newsletter` |
| Champs cachés | ~606 | `ml-submit` / `anticsrf` supprimés, `session` ajouté |
| Template liste d'attente | ~660 | **nouveau** `<template id="wait-template">` |
| iframe `ml-sink` | ~690 | supprimée (inutile avec `fetch`) |
| Bloc JS `setupEnroll` | ~810-930 | réécrit : `fetch` + états du bouton + 3 messages |

Aucune classe CSS n'a été supprimée, aucun texte visible n'a été modifié.
Le nouveau `wait-template` réutilise les classes `enroll eok` existantes.

---

## 2. Structure exacte de Google Sheets

Onglet : **`Inscriptions`** (nom exact, sensible à la casse).

| # | Colonne | Rempli par | Type |
|---|---|---|---|
| A | Date d'inscription | script | date/heure |
| B | Prénom | formulaire | texte |
| C | Nom | formulaire | texte |
| D | E-mail | formulaire | texte |
| E | Entreprise / activité | formulaire | texte |
| F | Attentes | formulaire | texte long |
| G | Newsletter | formulaire | `oui` / `non` |
| H | Consentement | formulaire | `oui` / `non` |
| I | **Statut** | script + toi | liste déroulante |
| J | Paiement reçu | toi | ☑ case à cocher |
| K | Date de paiement confirmé | script | date/heure |
| L | Confirmation envoyée | script | ☑ case à cocher |
| M | Date d'envoi de la confirmation | script | date/heure |
| N | Notes administratives | toi | texte libre |
| O | Action éventuelle | toi | texte libre |
| P | Session | script | `IA-GENERATIVE-2026-10` |
| Q | Historique | script | journal horodaté |

> Les colonnes P et Q ne figuraient pas dans le cahier des charges. Elles sont
> ajoutées parce que la première permet de réutiliser la même feuille pour la
> session suivante sans tout mélanger, et la seconde garde la trace des
> changements de statut — c'est ce qui permet de retrouver *qui a annulé quand*
> six mois plus tard.

### Statuts

| Statut | Compte dans les 20 places ? |
|---|---|
| `PLACE_RESERVEE_PAIEMENT_EN_ATTENTE` | ✅ oui |
| `PAIEMENT_RECU` | ✅ oui |
| `ANNULEE` | ❌ non |
| `PAIEMENT_NON_RECU` | ❌ non |
| `LISTE_ATTENTE` | ❌ non |

Le comptage se fait **par statut, jamais par nombre de lignes**. Une ligne
supprimée disparaît donc du comptage, et une ligne annulée conservée n'occupe
plus de place. Recalcul à chaque soumission.

### Couleurs (mise en forme conditionnelle, posée automatiquement)

vert = payé · orange = place réservée · rouge = annulée / impayée · gris = liste d'attente

---

## 3. Installation (une seule fois, ~10 minutes)

1. **Créer la feuille.** Google Drive → Nouveau → Google Sheets. Nommer par
   exemple *Inscriptions formation IA — octobre 2026*.
2. **Ouvrir l'éditeur de script.** Menu `Extensions ▸ Apps Script`.
3. **Coller le code.** Supprimer tout le contenu de `Code.gs`, coller
   l'intégralité du fichier `apps-script/Code.gs`. Enregistrer (Ctrl+S).
4. **Vérifier la configuration** en haut du fichier. Les coordonnées bancaires
   sont déjà renseignées :
   - Bénéficiaire : Agence Curcuma – Eve Schaller
   - IBAN : CH04 0840 1000 0785 4260 0 (Banque Migros)
   - Délai de paiement : 10 jours
   - Promotion automatique de la liste d'attente : activée
   Optionnel : déposer la QR-facture PDF sur Drive et coller son ID dans
   `QR_FACTURE_FILE_ID` pour la joindre automatiquement à l'e-mail de paiement.
5. **Lancer `installer`.** Dans la liste déroulante des fonctions en haut de
   l'éditeur, choisir `installer`, puis ▶ Exécuter. Google demande une
   autorisation : *Examiner les autorisations ▸ (ton compte) ▸ Paramètres
   avancés ▸ Accéder à … ▸ Autoriser*. Cela crée l'onglet, les en-têtes, les
   listes déroulantes, les cases à cocher, les couleurs et le déclencheur.
6. **Fermer et rouvrir la feuille** : le menu **Curcuma** apparaît.

---

## 4. Déploiement en application web

1. Dans l'éditeur : bouton bleu **Déployer ▸ Nouveau déploiement**.
2. Icône ⚙ à gauche → **Application web**.
3. Renseigner :
   - Description : `Inscriptions formation IA v1`
   - **Exécuter en tant que : Moi (eve@…)**
   - **Qui a accès : Tout le monde**  ← indispensable, le site est public
4. **Déployer**, autoriser si demandé.
5. **Copier l'URL de l'application web** (elle finit par `/exec`).

⚠️ *Chaque modification du code exige un **Déployer ▸ Gérer les déploiements ▸
✏️ ▸ Version : Nouvelle version ▸ Déployer**. Sans cela, l'ancienne version
continue de tourner. L'URL, elle, ne change pas.*

### Test rapide

Coller l'URL `/exec` dans un navigateur. Réponse attendue :

```json
{"status":"OK","places_max":20,"places_actives":0,"places_restantes":20,"complet":false}
```

---

## 5. Raccorder l'URL au formulaire

Ouvrir `formations.html`, chercher `GAS_ENDPOINT` (dans le `<script>` en bas de
page, section « INSCRIPTION ») :

```js
var GAS_ENDPOINT = 'COLLER_ICI_URL_WEB_APP_APPS_SCRIPT';
```

Remplacer par l'URL copiée :

```js
var GAS_ENDPOINT = 'https://script.google.com/macros/s/AKfycb…/exec';
```

Enregistrer, `git commit`, `git push`. GitHub Pages publie en 1-2 minutes.

Tant que l'URL n'est pas collée, le formulaire refuse d'envoyer et affiche un
message plutôt que de perdre une inscription dans le vide.

---

## 6. Procédures du quotidien

Toutes les actions passent par le menu **Curcuma** de Google Sheets.
**Sélectionner d'abord une cellule de la ligne concernée**, puis cliquer.

### Marquer un paiement reçu et envoyer la confirmation définitive
Deux méthodes, au choix :
- **Cocher la case « Paiement reçu » (colonne J)** — tout part automatiquement ;
- ou `Curcuma ▸ ✅ Marquer le paiement reçu + envoyer la confirmation`.

Dans les deux cas : statut → `PAIEMENT_RECU`, colonne K datée, e-mail de
confirmation définitive envoyé, colonne L cochée, colonne M datée.

### Empêcher un double envoi
La colonne **L « Confirmation envoyée »** fait office de verrou. Si elle est
déjà cochée, recocher J ou relancer l'action ne renvoie **rien** : un
avertissement s'affiche à la place. Pour renvoyer volontairement l'e-mail,
décocher L d'abord.

### Annuler une inscription / libérer une place
`Curcuma ▸ 🚫 Annuler cette inscription` → statut `ANNULEE`, confirmation
demandée. La ligne est conservée (historique administratif), la place est
libérée immédiatement.

### Paiement non reçu dans le délai
`Curcuma ▸ ⏳ Marquer « paiement non reçu »` → statut `PAIEMENT_NON_RECU`,
même effet.

*Variante manuelle :* changer directement le statut dans la colonne I via la
liste déroulante. Le résultat est identique — le déclencheur `onEdit` détecte
le changement.

### Promotion depuis la liste d'attente
**Automatique** (réglage actuel) : dès qu'une place se libère, la personne en
liste d'attente la plus ancienne passe en `PLACE_RESERVEE_PAIEMENT_EN_ATTENTE`
et reçoit les informations de paiement. Tu reçois une notification.

**Manuelle** : `Curcuma ▸ ⬆️ Promouvoir le suivant en liste d'attente`.
Pour désactiver l'automatisme : `PROMOTION_AUTO : false` en haut du script,
puis redéployer.

### Renvoyer les informations de paiement
`Curcuma ▸ 📧 Renvoyer les informations de paiement` (uniquement si la personne
est en statut « place réservée »).

### Voir l'état des places
`Curcuma ▸ 📊 Voir les places disponibles`.

### Si tu supprimes une ligne entière
Rien à faire : le comptage relit la colonne Statut à chaque soumission. La place
redevient disponible d'elle-même. **C'est toutefois déconseillé** — mieux vaut
passer en `ANNULEE` pour garder la trace, notamment vis-à-vis des frais
d'annulation prévus dans les CG.

---

## 7. Plan de test complet

À faire **avant** de communiquer sur la formation, avec des adresses e-mail à
toi. Baisser temporairement `PLACES_MAX` à 2 dans le script rend les tests 5
et 6 réalisables en deux minutes au lieu de vingt inscriptions.
**Ne pas oublier de remettre 20 et de redéployer ensuite.**

| # | Test | Manipulation | Résultat attendu |
|---|---|---|---|
| 1 | Inscription normale | Tous les champs, CG cochées | Ligne écrite · statut `PLACE_RESERVEE…` · e-mail paiement reçu (IBAN + référence + délai 10 jours) · notification admin · écran « Merci, c'est noté ! » |
| 2 | Champs facultatifs vides | Entreprise et Attentes laissés vides | Ligne écrite, colonnes E et F vides, aucune erreur |
| 3 | E-mail invalide | Saisir `test@` | Message rouge « Merci de renseigner votre prénom, votre nom et un e-mail valide », **aucun** envoi. Vérifier aussi côté backend : lancer `testEmailInvalide` dans l'éditeur → `{"status":"ERREUR"}` |
| 4 | CG non cochées | Tout remplir sauf la case CG | Message rouge, focus sur la case, aucun envoi |
| 5 | Dernière place (20ᵉ) | Inscrire jusqu'à `PLACES_MAX` | 20ᵉ : statut `PLACE_RESERVEE…`, e-mail de paiement. `Curcuma ▸ Voir les places` affiche `20 / 20` |
| 6 | Une place de trop (21ᵉ) | Inscription suivante | Statut `LISTE_ATTENTE` · e-mail liste d'attente **sans coordonnées bancaires** · écran « Les 20 places sont prises » |
| 7 | Annulation | Sur une ligne active : `Curcuma ▸ Annuler` | Statut `ANNULEE`, ligne conservée en rouge, historique complété. **Promotion auto** : la personne du test 6 passe en `PLACE_RESERVEE…` et reçoit les infos de paiement |
| 8 | Inscription après annulation | Nouvelle inscription (si `PROMOTION_AUTO:false`) | La place libérée est réattribuée, statut `PLACE_RESERVEE…` |
| 9 | Paiement reçu | Cocher la case J d'une ligne | Statut → `PAIEMENT_RECU` (vert) · K datée · e-mail de confirmation définitive · L cochée · M datée |
| 10 | Double envoi de confirmation | Décocher puis recocher J sur la même ligne | **Aucun second e-mail.** Avertissement / notification « Double envoi évité » |
| 11 | Honeypot anti-spam | Console : `document.querySelector('#site-web').value='bot'` puis envoyer | Écran de succès affiché, **aucune ligne écrite**, aucun e-mail |
| 12 | Double-clic | Cliquer 2× très vite sur « Réserver ma place » | Bouton désactivé + « Envoi en cours… », **une seule** ligne |
| 13 | Doublon d'adresse | Réinscrire la même adresse sur la même session | `{"status":"DOUBLON"}` · message « Cette adresse e-mail est déjà inscrite » · aucune ligne ajoutée |
| 14 | Ligne supprimée | Supprimer une ligne active, puis `Curcuma ▸ Voir les places` | Le compteur a baissé de 1 |
| 15 | Mobile | Refaire le test 1 depuis un téléphone | Mise en page identique, envoi et messages fonctionnels |

---

## 8. Sécurité et conformité

- Aucune clé, aucun secret dans le HTML ou le JS. L'URL `/exec` est publique par
  nature — elle n'accepte que des écritures de formulaire, ne lit rien et
  n'expose que le nombre de places libres.
- Validation e-mail **côté front et côté Apps Script** : la validation HTML
  seule n'est jamais considérée comme fiable.
- Nettoyage des entrées : caractères de contrôle retirés, longueurs bornées,
  valeurs commençant par `=`, `+`, `-`, `@` neutralisées (injection de formule
  dans Sheets).
- Honeypot `site_web` invisible : rempli par un robot ⇒ rien n'est écrit.
- `LockService` sur le comptage **et** l'écriture : deux soumissions simultanées
  ne peuvent pas obtenir la 20ᵉ place toutes les deux.
- Consentement marketing (newsletter) séparé du consentement contractuel (CG),
  cases décochées par défaut — exigence nLPD / RGPD.
- Aucune suppression automatique de données. Les annulations conservent la
  ligne et l'historique.
- Quota Gmail : 100 destinataires/jour en compte gratuit, 1 500 en Workspace.
  Largement suffisant pour 20 places, à garder en tête si tu ouvres plusieurs
  sessions le même jour.

---

## 9. En cas de problème

| Symptôme | Cause probable | Correctif |
|---|---|---|
| « Le formulaire n'est pas encore raccordé » | `GAS_ENDPOINT` non remplacé | Coller l'URL `/exec` (§5) |
| « Une erreur est survenue » systématique | Web App déployée en « Moi uniquement » | Redéployer avec « Qui a accès : Tout le monde » |
| Ligne écrite mais aucun e-mail | Autorisation Gmail non accordée | Relancer `installer` et accepter toutes les autorisations |
| Cocher « Paiement reçu » ne fait rien | Déclencheur absent | Lancer `setupDeclencheurs` |
| Menu « Curcuma » absent | Feuille pas rechargée | Fermer / rouvrir l'onglet du navigateur |
| Une modification du code reste sans effet | Nouvelle version non déployée | Déployer ▸ Gérer les déploiements ▸ ✏️ ▸ Nouvelle version |
| Comptage faux | Statut saisi à la main avec une faute | Utiliser la liste déroulante de la colonne I |

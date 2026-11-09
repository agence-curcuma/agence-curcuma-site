# Atelier Exploration IA — mode d'emploi

Page `atelier-exploration-ia.html` → Google Apps Script (`Code.gs`) → Google Sheets, Gmail, Agenda, Drive.
Système séparé de celui de la formation CREA : les deux ne se mélangent pas.

## Ce qui se passe tout seul

| Moment | Ce que fait le système |
|---|---|
| Inscription, places libres | Ligne `RESERVEE_72H` · facture PDF + bulletin QR envoyée à la personne · copie dans Drive (« Journée IA — factures ») · e-mail à Eve · agenda mis à jour |
| Chômage, ORP **déjà** validé | Place gardée **sans délai de 72 h** · facture à transmettre à la caisse · e-mail à Eve marqué (chômage). Eve met `PRISE_EN_CHARGE` à réception du courrier de l'ORP |
| Chômage, ORP **pas encore** validé | `PREINSCRIPTION_ORP` : aucune place bloquée, aucune facture, jamais promue automatiquement. Quand l'ORP valide, Eve met `PRISE_EN_CHARGE` : place confirmée avec la facture si une place est libre, sinon liste d'attente |
| Inscription, 4 places occupées | Ligne `LISTE_ATTENTE` · e-mail « liste d'attente » (sans facture) |
| 72 h sans paiement | Si quelqu'un attend ou s'inscrit : l'inscription non payée est **désactivée** (`DESACTIVEE`, distinct de la liste d'attente), la place va à la personne suivante, et la personne reçoit « Inscription annulée » avec un **lien personnel de réactivation** (place libre → nouvelle réservation 72 h + facture ; date pleine → liste d'attente). Si personne n'attend : la place est gardée, Eve reçoit « Paiement en retard » |
| 7 jours avant | Rappel aux personnes confirmées : infos pratiques, accès (parc, vélos, bus), lien Google Maps, fichier agenda |
| 4 places confirmées | E-mail « ✅ COMPLET » à Eve (une seule fois par date) |
| 7 jours avant, moins de 2 confirmées | E-mail « Minimum pas atteint » à Eve |
| La veille à 12h00 | Inscriptions fermées pour cette date |

Vérification automatique toutes les heures.

## Ce que fait Eve dans la feuille

- **Paiement reçu** → cocher la case « Paiement reçu ». Statut `PAYEE`, e-mail de confirmation avec le rendez-vous pour l'agenda.
- **Courrier de l'ORP** → mettre le statut sur `PRISE_EN_CHARGE`. Même effet, sans attendre le paiement. Si l'ORP refuse : statut `ANNULEE` (la place passe à la personne suivante).
- **Annulation** → statut `ANNULEE`. La place va automatiquement à la première personne en liste d'attente.
- Menu **Atelier IA** : voir les places, renvoyer une facture, forcer une vérification.

### Annuler une date (minimum non atteint, maladie…)

Menu **Atelier IA ▸ ❌ Annuler une date** : choisir la date, puis le motif (OUI = minimum non atteint, NON = empêchement de ta part). En cas d'empêchement, tu peux écrire une phrase personnelle (facultatif) ajoutée à tous les e-mails, juste après l'annonce. Utilisable à tout moment, même la veille.

- La date est fermée sur le site (« Date annulée »), plus de rappel ni d'e-mail automatique pour elle, l'événement de l'agenda devient « ANNULÉ ».
- Chaque personne reçoit un e-mail adapté, avec des liens personnels :
  - **a payé** → « Reporter sur une autre date » (place confirmée sans repayer) ou « Être remboursé·e » ;
  - **prise en charge chômage** → reporter, ou annuler son inscription ;
  - **paiement pas encore reçu** → ne pas payer la facture, report possible (nouvelle facture) ;
  - **liste d'attente / pré-inscription** → report possible.
- Tu reçois un récapitulatif, puis un e-mail à chaque choix.
- Remboursement demandé → statut `A_REMBOURSER` (rouge) : fais le virement, puis mets `ANNULEE`.
- Sans réponse : la ligne reste en `DATE_ANNULEE` (jaune), l'e-mail annonce que tu rembourses par défaut.

## Installation (une fois, ~10 minutes)

> À faire **connecté·e avec eve@agence-curcuma.ch** : c'est ce compte qui envoie les e-mails et dont l'agenda reçoit les journées.

1. Google Drive → Nouveau → Google Sheets. Nom : *Inscriptions Journée IA*.
2. Extensions ▸ Apps Script. Effacer le contenu, coller **tout** `Code.gs`, enregistrer.
3. Choisir la fonction `installer` ▸ Exécuter ▸ accepter les autorisations
   (Paramètres avancés ▸ Accéder au projet ▸ Autoriser).
   → crée l'onglet, les déclencheurs, les 3 journées dans l'agenda et le dossier Drive des factures.
4. Lancer `testFacture` : tu reçois une facture d'exemple. Scanner le QR avec l'app de la banque pour vérifier (sans payer).
5. Déployer ▸ Nouveau déploiement ▸ ⚙ Application web
   - Exécuter en tant que : **Moi**
   - Qui a accès : **Tout le monde**
   → copier l'URL qui finit par `/exec`.
6. Dans `atelier-exploration-ia.html`, remplacer `COLLER_ICI_URL_WEB_APP_ATELIER_IA` par cette URL (ou la transmettre à Claude).

Après chaque modification du code : Déployer ▸ Gérer les déploiements ▸ ✏️ ▸ Nouvelle version.

## Ajouter une date

1. `Code.gs`, bloc `SESSIONS` : ajouter `{ id: 'JIA-2027-03-11', date: '2027-03-11', label: 'jeudi 11 mars 2027' }`, puis nouvelle version du déploiement et relancer `installer` (crée l'événement dans l'agenda).
2. `atelier-exploration-ia.html` : ajouter une carte `dcard` avec le même `id` (et dans le JSON-LD).

## Testé avant livraison

Simulation complète hors ligne (75 vérifications : chômage, pré-inscription ORP, désactivation et réactivation par lien, rappel J-7, annulation d'une date avec report et remboursement) : 5 inscriptions, paiement, prise en charge, double clic sur « payé », réservations échues, liste d'attente, nouvelle inscription sur réservation échue, paiement tardif sur date pleine, annulation, alerte minimum, clôture la veille. Le contenu du QR est identique à celui de la bibliothèque de référence `qrbill`, et le QR du PDF est relu correctement.

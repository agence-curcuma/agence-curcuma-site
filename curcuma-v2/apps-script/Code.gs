/**
 * ============================================================================
 *  AGENCE CURCUMA — Inscriptions formation (Google Apps Script)
 *  Backend du formulaire de formations.html
 *
 *  Reçoit les inscriptions, écrit dans Google Sheets, compte les places
 *  ACTIVES (jamais les lignes), gère la liste d'attente et les e-mails.
 *
 *  ⚠️  AVANT DÉPLOIEMENT : compléter le bloc CONFIG ci-dessous
 *      (au minimum BENEFICIAIRE et IBAN).
 * ============================================================================
 */

/* ==========================================================================
   1. CONFIGURATION — la seule partie à modifier au quotidien
   ========================================================================== */
var CONFIG = {

  /* --- Feuille ---------------------------------------------------------- */
  SHEET_NAME      : 'Inscriptions',   // nom exact de l'onglet
  PLACES_MAX      : 20,               // limite de places actives

  /* --- Événement -------------------------------------------------------- */
  SESSION_ID      : 'IA-GENERATIVE-2026-10',
  EVENEMENT       : 'Session — IA générative (3 jours)',
  DATES           : '21, 22 et 23 octobre 2026',
  LIEU            : 'Delémont',

  /* --- Paiement --------------------------------------------------------- */
  MONTANT         : 'CHF 1450.–',
  BENEFICIAIRE    : 'Agence Curcuma – Eve Schaller',
  IBAN            : 'CH04 0840 1000 0785 4260 0',
  BANQUE          : 'Banque Migros',
  /* La référence est complétée avec le nom de la personne à l'envoi :
     ex. « FORMATION-IA-2026 / Camille Rossier » */
  REFERENCE_BASE  : 'FORMATION-IA-2026',
  DELAI_PAIEMENT  : '10 jours',

  /* Facultatif — ID d'un fichier Google Drive (PDF de la QR-facture) joint à
     l'e-mail de paiement. Laisser vide pour ne rien joindre.
     L'ID se lit dans l'URL du fichier : .../file/d/ICI_L_ID/view */
  QR_FACTURE_FILE_ID : '',

  /* --- Expéditeur / administration -------------------------------------- */
  ADMIN_EMAIL     : 'eve@agence-curcuma.ch',
  EXPEDITEUR_NOM  : 'Agence Curcuma',
  REPLY_TO        : 'eve@agence-curcuma.ch',

  /* --- Comportement ----------------------------------------------------- */
  /* true  = quand un statut passe à ANNULEE / PAIEMENT_NON_RECU, la première
              personne en liste d'attente est promue et reçoit les infos de
              paiement automatiquement.
     false = promotion uniquement via le menu « Curcuma ▸ Promouvoir… ». */
  PROMOTION_AUTO  : true,

  /* Refuser une 2e inscription avec la même adresse e-mail sur la session. */
  BLOQUER_DOUBLONS: true
};

/* Statuts — ne pas modifier les chaînes sans mettre à jour la feuille. */
var ST = {
  RESERVEE : 'PLACE_RESERVEE_PAIEMENT_EN_ATTENTE',
  PAYE     : 'PAIEMENT_RECU',
  ANNULEE  : 'ANNULEE',
  IMPAYE   : 'PAIEMENT_NON_RECU',
  ATTENTE  : 'LISTE_ATTENTE'
};

/* Statuts qui consomment une place. */
var STATUTS_ACTIFS = [ST.RESERVEE, ST.PAYE];

/* Colonnes (1-indexées). L'ordre doit correspondre à HEADERS ci-dessous. */
var COL = {
  DATE_INSCRIPTION : 1,
  PRENOM           : 2,
  NOM              : 3,
  EMAIL            : 4,
  ENTREPRISE       : 5,
  ATTENTES         : 6,
  NEWSLETTER       : 7,
  CONSENTEMENT     : 8,
  STATUT           : 9,
  PAIEMENT_RECU    : 10,
  DATE_PAIEMENT    : 11,
  CONFIRM_ENVOYEE  : 12,
  DATE_CONFIRM     : 13,
  NOTES            : 14,
  ACTION           : 15,
  SESSION          : 16,
  HISTORIQUE       : 17
};

var HEADERS = [
  "Date d'inscription", 'Prénom', 'Nom', 'E-mail', 'Entreprise / activité',
  'Attentes', 'Newsletter', 'Consentement', 'Statut', 'Paiement reçu',
  'Date de paiement confirmé', 'Confirmation envoyée', "Date d'envoi de la confirmation",
  'Notes administratives', 'Action éventuelle', 'Session', 'Historique'
];

var LAST_COL = HEADERS.length;


/* ==========================================================================
   2. POINT D'ENTRÉE WEB — doPost / doGet
   ========================================================================== */

/**
 * Reçoit le formulaire. Accepte deux formats :
 *  - JSON brut en text/plain  (chemin normal, utilisé par formations.html)
 *  - form-urlencoded          (secours / test via un <form> classique)
 */
function doPost(e) {
  try {
    var data = lireRequete_(e);

    /* --- Anti-spam : honeypot rempli => on répond OK sans rien écrire ---- */
    if (nettoyer_(data.site_web)) {
      return json_({ status: 'INSCRIT', message: 'ok' });
    }

    /* --- Nettoyage + validation ---------------------------------------- */
    var inscr = {
      prenom       : nettoyer_(data.prenom, 80),
      nom          : nettoyer_(data.nom, 80),
      email        : nettoyer_(data.email, 120).toLowerCase(),
      entreprise   : nettoyer_(data.entreprise, 150),
      attentes     : nettoyer_(data.attentes, 2000),
      newsletter   : estCoche_(data.newsletter) ? 'oui' : 'non',
      consentement : estCoche_(data.consentement) ? 'oui' : 'non',
      session      : nettoyer_(data.session, 60) || CONFIG.SESSION_ID
    };

    if (!inscr.prenom || !inscr.nom) {
      return json_({ status: 'ERREUR', message: 'Le prénom et le nom sont obligatoires.' });
    }
    if (!emailValide_(inscr.email)) {
      return json_({ status: 'ERREUR', message: 'Adresse e-mail invalide.' });
    }
    if (inscr.consentement !== 'oui') {
      return json_({ status: 'ERREUR', message: "L'acceptation des conditions générales est nécessaire." });
    }

    /* --- Section critique : comptage + écriture sous verrou ------------- */
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) {
      return json_({ status: 'ERREUR', message: 'Service momentanément occupé, merci de réessayer.' });
    }

    var resultat;
    try {
      var sh = getSheet_();

      if (CONFIG.BLOQUER_DOUBLONS && emailDejaInscrit_(sh, inscr.email, inscr.session)) {
        return json_({ status: 'DOUBLON', message: 'Cette adresse est déjà inscrite à cette session.' });
      }

      var actives = compterPlacesActives_(sh, inscr.session);
      var statut  = (actives < CONFIG.PLACES_MAX) ? ST.RESERVEE : ST.ATTENTE;

      var ligne = ecrireInscription_(sh, inscr, statut);
      resultat  = { statut: statut, ligne: ligne, actives: actives };

    } finally {
      lock.releaseLock();          // toujours libéré, même en cas d'erreur
    }

    /* --- E-mails hors verrou (MailApp est lent, inutile de bloquer) ----- */
    if (resultat.statut === ST.RESERVEE) {
      envoyerEmailPaiement_(inscr);
      notifierAdmin_('Nouvelle inscription — place réservée',
        resumeAdmin_(inscr, ST.RESERVEE, resultat.actives + 1, resultat.ligne));
      return json_({
        status: 'INSCRIT',
        places_restantes: Math.max(0, CONFIG.PLACES_MAX - (resultat.actives + 1))
      });
    }

    envoyerEmailListeAttente_(inscr);
    notifierAdmin_("Nouvelle demande — liste d'attente",
      resumeAdmin_(inscr, ST.ATTENTE, resultat.actives, resultat.ligne));
    return json_({ status: 'LISTE_ATTENTE', places_restantes: 0 });

  } catch (err) {
    try {
      notifierAdmin_('⚠️ Erreur du formulaire d\'inscription',
        'Une inscription a échoué.\n\n' + err + '\n\n' + (err && err.stack ? err.stack : ''));
    } catch (e2) {}
    return json_({ status: 'ERREUR', message: 'Une erreur est survenue. Veuillez réessayer ou nous contacter.' });
  }
}

/**
 * Ping / état des places. Utile pour tester le déploiement depuis un
 * navigateur : ouvrir l'URL /exec doit afficher un petit JSON.
 */
function doGet(e) {
  try {
    var session = (e && e.parameter && e.parameter.session) ? e.parameter.session : CONFIG.SESSION_ID;
    var actives = compterPlacesActives_(getSheet_(), session);
    return json_({
      status          : 'OK',
      session         : session,
      places_max      : CONFIG.PLACES_MAX,
      places_actives  : actives,
      places_restantes: Math.max(0, CONFIG.PLACES_MAX - actives),
      complet         : actives >= CONFIG.PLACES_MAX
    });
  } catch (err) {
    return json_({ status: 'ERREUR', message: String(err) });
  }
}

/** Lit le corps de la requête, quel que soit son format. */
function lireRequete_(e) {
  if (e && e.postData && e.postData.contents) {
    var brut = e.postData.contents;
    var t = String(e.postData.type || '');
    if (t.indexOf('json') === -1 && t.indexOf('plain') === -1) {
      return (e.parameter || {});                 // form-urlencoded
    }
    try { return JSON.parse(brut); } catch (err) { return (e.parameter || {}); }
  }
  return (e && e.parameter) ? e.parameter : {};
}

/** Réponse JSON. */
function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


/* ==========================================================================
   3. FEUILLE — accès, comptage, écriture
   ========================================================================== */

/** Récupère l'onglet, le crée et le met en forme s'il n'existe pas. */
function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(CONFIG.SHEET_NAME);
    initialiserFeuille();
  }
  return sh;
}

/**
 * Compte les places réellement occupées.
 * On ne compte JAMAIS le nombre de lignes : uniquement les lignes dont le
 * statut appartient à STATUTS_ACTIFS. Une ligne supprimée disparaît donc
 * naturellement du comptage, et une ligne ANNULEE / PAIEMENT_NON_RECU /
 * LISTE_ATTENTE ne consomme pas de place.
 */
function compterPlacesActives_(sh, session) {
  var dernier = sh.getLastRow();
  if (dernier < 2) return 0;

  var n       = dernier - 1;
  var statuts = sh.getRange(2, COL.STATUT,  n, 1).getValues();
  var sess    = sh.getRange(2, COL.SESSION, n, 1).getValues();
  var cible   = session || CONFIG.SESSION_ID;
  var total   = 0;

  for (var i = 0; i < n; i++) {
    var st = String(statuts[i][0] || '').trim().toUpperCase();
    var sn = String(sess[i][0] || '').trim();
    if (sn && sn !== cible) continue;               // autre session : ignorée
    if (STATUTS_ACTIFS.indexOf(st) !== -1) total++;
  }
  return total;
}

/** Vrai si l'adresse est déjà présente avec un statut non annulé. */
function emailDejaInscrit_(sh, email, session) {
  var dernier = sh.getLastRow();
  if (dernier < 2) return false;

  var n      = dernier - 1;
  var mails  = sh.getRange(2, COL.EMAIL,   n, 1).getValues();
  var stats  = sh.getRange(2, COL.STATUT,  n, 1).getValues();
  var sess   = sh.getRange(2, COL.SESSION, n, 1).getValues();
  var cible  = session || CONFIG.SESSION_ID;

  for (var i = 0; i < n; i++) {
    var m  = String(mails[i][0] || '').trim().toLowerCase();
    var st = String(stats[i][0] || '').trim().toUpperCase();
    var sn = String(sess[i][0] || '').trim();
    if (sn && sn !== cible) continue;
    if (m === email && st !== ST.ANNULEE && st !== ST.IMPAYE) return true;
  }
  return false;
}

/** Ajoute la ligne d'inscription. Retourne son numéro. */
function ecrireInscription_(sh, inscr, statut) {
  var maintenant = new Date();
  var ligne = [
    maintenant,           // Date d'inscription
    inscr.prenom,
    inscr.nom,
    inscr.email,
    inscr.entreprise,
    inscr.attentes,
    inscr.newsletter,
    inscr.consentement,
    statut,
    false,                // Paiement reçu (case à cocher)
    '',                   // Date de paiement confirmé
    false,                // Confirmation envoyée (case à cocher)
    '',                   // Date d'envoi de la confirmation
    '',                   // Notes administratives
    '',                   // Action éventuelle
    inscr.session,
    horodate_(maintenant) + ' — création : ' + statut
  ];
  sh.appendRow(ligne);

  var r = sh.getLastRow();
  sh.getRange(r, COL.PAIEMENT_RECU).insertCheckboxes();
  sh.getRange(r, COL.CONFIRM_ENVOYEE).insertCheckboxes();
  SpreadsheetApp.flush();
  return r;
}

/** Lit une ligne sous forme d'objet exploitable. */
function lireLigne_(sh, r) {
  var v = sh.getRange(r, 1, 1, LAST_COL).getValues()[0];
  return {
    ligne        : r,
    date         : v[COL.DATE_INSCRIPTION - 1],
    prenom       : String(v[COL.PRENOM - 1] || ''),
    nom          : String(v[COL.NOM - 1] || ''),
    email        : String(v[COL.EMAIL - 1] || '').trim(),
    entreprise   : String(v[COL.ENTREPRISE - 1] || ''),
    attentes     : String(v[COL.ATTENTES - 1] || ''),
    newsletter   : String(v[COL.NEWSLETTER - 1] || ''),
    consentement : String(v[COL.CONSENTEMENT - 1] || ''),
    statut       : String(v[COL.STATUT - 1] || '').trim().toUpperCase(),
    paiementRecu : v[COL.PAIEMENT_RECU - 1] === true,
    confirmEnv   : v[COL.CONFIRM_ENVOYEE - 1] === true,
    session      : String(v[COL.SESSION - 1] || '') || CONFIG.SESSION_ID
  };
}

/** Ajoute une entrée horodatée dans la colonne Historique. */
function tracer_(sh, r, texte) {
  var c = sh.getRange(r, COL.HISTORIQUE);
  var ancien = String(c.getValue() || '');
  var nouveau = horodate_(new Date()) + ' — ' + texte;
  c.setValue(ancien ? (ancien + '\n' + nouveau) : nouveau);
}


/* ==========================================================================
   4. E-MAILS
   ========================================================================== */

/** E-mail envoyé à qui obtient une place : contient les infos de paiement. */
function envoyerEmailPaiement_(inscr) {
  var reference = CONFIG.REFERENCE_BASE + ' / ' + inscr.prenom + ' ' + inscr.nom;

  var corps =
    'Bonjour ' + inscr.prenom + ',\n\n' +
    'Nous avons bien reçu ton inscription à la session « IA générative — 3 jours », ' +
    'qui aura lieu les ' + CONFIG.DATES + ' à ' + CONFIG.LIEU + '.\n\n' +
    'Pour confirmer définitivement ta place, merci d\'effectuer le paiement suivant :\n\n' +
    'Montant : ' + CONFIG.MONTANT + '\n' +
    'Bénéficiaire : ' + CONFIG.BENEFICIAIRE + '\n' +
    'IBAN : ' + CONFIG.IBAN + '\n' +
    (CONFIG.BANQUE ? 'Banque : ' + CONFIG.BANQUE + '\n' : '') +
    'Référence / communication : ' + reference + '\n\n' +
    'Merci d\'effectuer le paiement dans un délai de ' + CONFIG.DELAI_PAIEMENT + '.\n' +
    'Ta place sera définitivement confirmée après réception du règlement.\n\n' +
    'Le prix comprend les repas de midi, les boissons et les cafés pendant toute la durée de la formation.\n\n' +
    'Avec nos meilleures salutations,\n' +
    'Agence Curcuma';

  /* QR-facture jointe si un fichier Drive a été renseigné dans CONFIG. */
  var pj = [];
  if (CONFIG.QR_FACTURE_FILE_ID) {
    try { pj.push(DriveApp.getFileById(CONFIG.QR_FACTURE_FILE_ID).getBlob()); }
    catch (e) { notifierAdmin_('⚠️ QR-facture introuvable', 'QR_FACTURE_FILE_ID invalide : ' + e); }
  }

  envoyer_(inscr.email,
    'Inscription reçue — ' + CONFIG.EVENEMENT + ' — informations de paiement',
    corps, pj);
}

/** E-mail envoyé à qui arrive en liste d'attente : aucune info de paiement. */
function envoyerEmailListeAttente_(inscr) {
  var corps =
    'Bonjour ' + inscr.prenom + ',\n\n' +
    'Merci pour ton intérêt pour la session « IA générative — 3 jours » ' +
    'des ' + CONFIG.DATES + ' à ' + CONFIG.LIEU + '.\n\n' +
    'Les ' + CONFIG.PLACES_MAX + ' places sont actuellement attribuées. ' +
    'Ta demande est enregistrée en liste d\'attente.\n\n' +
    'Si une place se libère, nous te contactons dans l\'ordre d\'arrivée et tu recevras ' +
    'à ce moment-là les informations de paiement. Aucun règlement ne t\'est demandé d\'ici là.\n\n' +
    'Avec nos meilleures salutations,\n' +
    'Agence Curcuma';

  envoyer_(inscr.email,
    'Liste d\'attente — ' + CONFIG.EVENEMENT,
    corps);
}

/** E-mail de confirmation définitive, après réception du paiement. */
function envoyerEmailConfirmation_(inscr) {
  var corps =
    'Bonjour ' + inscr.prenom + ',\n\n' +
    'Nous confirmons la réception de ton paiement.\n' +
    'Ton inscription à la session « IA générative — 3 jours » est donc définitivement confirmée.\n\n' +
    'Dates : ' + CONFIG.DATES + '\n' +
    'Lieu : ' + CONFIG.LIEU + '\n' +
    'Montant réglé : ' + CONFIG.MONTANT + '\n\n' +
    'Les repas de midi, les boissons et les cafés sont inclus pendant toute la durée de la formation.\n\n' +
    'Nous te transmettrons les dernières informations pratiques (horaires, accès) avant la formation.\n\n' +
    'Merci de ta confiance, et à bientôt.\n\n' +
    'Avec nos meilleures salutations,\n' +
    'Agence Curcuma';

  envoyer_(inscr.email,
    'Confirmation définitive de votre inscription – Session IA générative',
    corps);
}

/** Notification à l'administratrice. */
function notifierAdmin_(sujet, corps) {
  if (!CONFIG.ADMIN_EMAIL) return;
  try {
    MailApp.sendEmail({
      to      : CONFIG.ADMIN_EMAIL,
      subject : '[Curcuma] ' + sujet,
      body    : corps,
      name    : CONFIG.EXPEDITEUR_NOM
    });
  } catch (e) { /* une notification perdue ne doit jamais casser une inscription */ }
}

/** Envoi générique. */
function envoyer_(destinataire, sujet, corps, pieces) {
  var opts = {
    to      : destinataire,
    subject : sujet,
    body    : corps,
    name    : CONFIG.EXPEDITEUR_NOM,
    replyTo : CONFIG.REPLY_TO
  };
  if (pieces && pieces.length) opts.attachments = pieces;
  MailApp.sendEmail(opts);
}

/** Corps du message envoyé à l'administratrice. */
function resumeAdmin_(inscr, statut, actives, ligne) {
  return [
    'Statut : ' + statut,
    'Ligne  : ' + ligne,
    '',
    'Prénom     : ' + inscr.prenom,
    'Nom        : ' + inscr.nom,
    'E-mail     : ' + inscr.email,
    'Entreprise : ' + (inscr.entreprise || '—'),
    'Newsletter : ' + inscr.newsletter,
    '',
    'Attentes :',
    (inscr.attentes || '—'),
    '',
    'Places actives : ' + actives + ' / ' + CONFIG.PLACES_MAX
  ].join('\n');
}


/* ==========================================================================
   5. ACTIONS ADMINISTRATIVES — menu Google Sheets
   ========================================================================== */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Curcuma')
    .addItem('✅ Marquer le paiement reçu + envoyer la confirmation', 'actionConfirmerPaiement')
    .addItem('📧 Renvoyer les informations de paiement', 'actionRenvoyerInfosPaiement')
    .addSeparator()
    .addItem('🚫 Annuler cette inscription (libère la place)', 'actionAnnuler')
    .addItem('⏳ Marquer « paiement non reçu » (libère la place)', 'actionPaiementNonRecu')
    .addSeparator()
    .addItem('⬆️ Promouvoir le suivant en liste d\'attente', 'actionPromouvoirSuivant')
    .addItem('📊 Voir les places disponibles', 'actionEtatPlaces')
    .addSeparator()
    .addItem('🛠️ Initialiser / réparer la feuille', 'initialiserFeuille')
    .addToUi();
}

/**
 * Case « Paiement reçu » cochée à la main → confirmation automatique.
 * Déclencheur installable requis (voir setupDeclencheurs).
 */
function onEditInstallable(e) {
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet();
    if (sh.getName() !== CONFIG.SHEET_NAME) return;
    var r = e.range.getRow(), c = e.range.getColumn();
    if (r < 2) return;

    /* Case « Paiement reçu » cochée */
    if (c === COL.PAIEMENT_RECU && e.value === 'TRUE') {
      confirmerPaiement_(sh, r, false);
      return;
    }

    /* Statut passé manuellement à ANNULEE / PAIEMENT_NON_RECU */
    if (c === COL.STATUT) {
      var nouveau = String(e.value || '').trim().toUpperCase();
      var ancien  = String(e.oldValue || '').trim().toUpperCase();
      if (nouveau === ancien) return;

      tracer_(sh, r, 'statut : ' + (ancien || '—') + ' → ' + nouveau);

      var libere = (nouveau === ST.ANNULEE || nouveau === ST.IMPAYE);
      var avaitPlace = (STATUTS_ACTIFS.indexOf(ancien) !== -1);

      if (libere && avaitPlace) {
        var p = lireLigne_(sh, r);
        notifierAdmin_('Place libérée — ' + nouveau,
          p.prenom + ' ' + p.nom + ' (' + p.email + ', ligne ' + r + ') est passé·e en ' + nouveau + '.\n' +
          'Une place est donc disponible.');
        if (CONFIG.PROMOTION_AUTO) promouvoirSuivant_(sh, p.session, true);
      }
    }
  } catch (err) {
    notifierAdmin_('⚠️ Erreur onEdit', String(err) + '\n' + (err && err.stack ? err.stack : ''));
  }
}

/* --- Éléments de menu ----------------------------------------------------- */

function actionConfirmerPaiement() {
  var sh = SpreadsheetApp.getActiveSheet();
  var r  = SpreadsheetApp.getActiveRange().getRow();
  if (sh.getName() !== CONFIG.SHEET_NAME || r < 2) {
    return alerte_('Sélectionnez d\'abord la ligne de la personne dans l\'onglet « ' + CONFIG.SHEET_NAME + ' ».');
  }
  confirmerPaiement_(sh, r, true);
}

function actionRenvoyerInfosPaiement() {
  var sh = SpreadsheetApp.getActiveSheet();
  var r  = SpreadsheetApp.getActiveRange().getRow();
  if (sh.getName() !== CONFIG.SHEET_NAME || r < 2) return alerte_('Sélectionnez d\'abord une ligne.');

  var p = lireLigne_(sh, r);
  if (p.statut !== ST.RESERVEE) {
    return alerte_('Cette personne a le statut « ' + p.statut + ' ». Les informations de paiement ne s\'envoient qu\'en statut ' + ST.RESERVEE + '.');
  }
  envoyerEmailPaiement_(p);
  tracer_(sh, r, 'infos de paiement renvoyées manuellement');
  alerte_('Informations de paiement renvoyées à ' + p.email + '.');
}

function actionAnnuler()        { changerStatutSelection_(ST.ANNULEE); }
function actionPaiementNonRecu(){ changerStatutSelection_(ST.IMPAYE);  }

function actionPromouvoirSuivant() {
  var sh = getSheet_();
  var promu = promouvoirSuivant_(sh, CONFIG.SESSION_ID, false);
  if (!promu) return alerte_('Aucune promotion effectuée : soit la liste d\'attente est vide, soit les ' + CONFIG.PLACES_MAX + ' places sont déjà occupées.');
  alerte_(promu.prenom + ' ' + promu.nom + ' (' + promu.email + ') a été promu·e.\n' +
          'Statut : ' + ST.RESERVEE + '. Les informations de paiement viennent d\'être envoyées.');
}

function actionEtatPlaces() {
  var sh = getSheet_();
  var a  = compterPlacesActives_(sh, CONFIG.SESSION_ID);
  var attente = compterParStatut_(sh, ST.ATTENTE, CONFIG.SESSION_ID);
  alerte_(
    'Places actives : ' + a + ' / ' + CONFIG.PLACES_MAX + '\n' +
    'Places disponibles : ' + Math.max(0, CONFIG.PLACES_MAX - a) + '\n' +
    'En liste d\'attente : ' + attente + '\n\n' +
    'Détail :\n' +
    '· ' + ST.RESERVEE + ' : ' + compterParStatut_(sh, ST.RESERVEE, CONFIG.SESSION_ID) + '\n' +
    '· ' + ST.PAYE     + ' : ' + compterParStatut_(sh, ST.PAYE,     CONFIG.SESSION_ID) + '\n' +
    '· ' + ST.ANNULEE  + ' : ' + compterParStatut_(sh, ST.ANNULEE,  CONFIG.SESSION_ID) + '\n' +
    '· ' + ST.IMPAYE   + ' : ' + compterParStatut_(sh, ST.IMPAYE,   CONFIG.SESSION_ID)
  );
}

/* --- Logique des actions -------------------------------------------------- */

/**
 * Passe la ligne en PAIEMENT_RECU et envoie la confirmation définitive.
 * Protection anti-doublon : si « Confirmation envoyée » est déjà cochée,
 * rien n'est renvoyé.
 */
function confirmerPaiement_(sh, r, interactif) {
  var p = lireLigne_(sh, r);

  if (!p.email) { if (interactif) alerte_('Ligne sans adresse e-mail.'); return; }

  if (p.confirmEnv) {
    var msg = 'La confirmation a DÉJÀ été envoyée à ' + p.email + ' — aucun second e-mail n\'a été envoyé.';
    if (interactif) alerte_(msg); else notifierAdmin_('Double envoi évité', msg + '\nLigne ' + r + '.');
    sh.getRange(r, COL.PAIEMENT_RECU).setValue(true);
    if (p.statut !== ST.PAYE) sh.getRange(r, COL.STATUT).setValue(ST.PAYE);
    return;
  }

  if (p.statut === ST.ATTENTE) {
    if (interactif) alerte_('Cette personne est en liste d\'attente. Promouvez-la d\'abord (menu Curcuma ▸ Promouvoir).');
    return;
  }

  var maintenant = new Date();
  sh.getRange(r, COL.STATUT).setValue(ST.PAYE);
  sh.getRange(r, COL.PAIEMENT_RECU).setValue(true);
  sh.getRange(r, COL.DATE_PAIEMENT).setValue(maintenant);

  envoyerEmailConfirmation_(p);

  sh.getRange(r, COL.CONFIRM_ENVOYEE).setValue(true);
  sh.getRange(r, COL.DATE_CONFIRM).setValue(maintenant);
  tracer_(sh, r, 'paiement confirmé + e-mail de confirmation définitive envoyé');
  SpreadsheetApp.flush();

  notifierAdmin_('Paiement confirmé',
    p.prenom + ' ' + p.nom + ' (' + p.email + ') — ligne ' + r + '. Confirmation définitive envoyée.');

  if (interactif) alerte_('Paiement enregistré. Confirmation définitive envoyée à ' + p.email + '.');
}

/** Change le statut de la ligne sélectionnée, avec confirmation. */
function changerStatutSelection_(statut) {
  var sh = SpreadsheetApp.getActiveSheet();
  var r  = SpreadsheetApp.getActiveRange().getRow();
  if (sh.getName() !== CONFIG.SHEET_NAME || r < 2) return alerte_('Sélectionnez d\'abord une ligne.');

  var p  = lireLigne_(sh, r);
  var ui = SpreadsheetApp.getUi();
  var rep = ui.alert('Confirmer',
    'Passer ' + p.prenom + ' ' + p.nom + ' (' + p.email + ') en « ' + statut + ' » ?\n\n' +
    'La ligne est conservée pour l\'historique, mais la place est libérée.',
    ui.ButtonSet.YES_NO);
  if (rep !== ui.Button.YES) return;

  var avaitPlace = (STATUTS_ACTIFS.indexOf(p.statut) !== -1);
  sh.getRange(r, COL.STATUT).setValue(statut);
  tracer_(sh, r, 'statut : ' + p.statut + ' → ' + statut + ' (action manuelle)');
  SpreadsheetApp.flush();

  if (avaitPlace && CONFIG.PROMOTION_AUTO) {
    var promu = promouvoirSuivant_(sh, p.session, true);
    if (promu) {
      return alerte_('Statut mis à jour.\n\nUne place s\'est libérée : ' + promu.prenom + ' ' + promu.nom +
                     ' a été promu·e depuis la liste d\'attente et a reçu les informations de paiement.');
    }
  }
  alerte_('Statut mis à jour. Place libérée : ' +
          Math.max(0, CONFIG.PLACES_MAX - compterPlacesActives_(sh, p.session)) + ' place(s) disponible(s).');
}

/**
 * Promeut la personne la plus ancienne en LISTE_ATTENTE si une place est
 * libre. Retourne l'objet promu, ou null.
 */
function promouvoirSuivant_(sh, session, silencieux) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return null;

  try {
    var cible = session || CONFIG.SESSION_ID;
    if (compterPlacesActives_(sh, cible) >= CONFIG.PLACES_MAX) return null;

    var dernier = sh.getLastRow();
    if (dernier < 2) return null;

    var n = dernier - 1;
    var stats = sh.getRange(2, COL.STATUT,  n, 1).getValues();
    var sess  = sh.getRange(2, COL.SESSION, n, 1).getValues();

    /* La feuille est en ordre d'arrivée : le premier LISTE_ATTENTE trouvé
       en partant du haut est le plus ancien. */
    for (var i = 0; i < n; i++) {
      var st = String(stats[i][0] || '').trim().toUpperCase();
      var sn = String(sess[i][0] || '').trim();
      if (sn && sn !== cible) continue;
      if (st !== ST.ATTENTE) continue;

      var r = i + 2;
      var p = lireLigne_(sh, r);
      sh.getRange(r, COL.STATUT).setValue(ST.RESERVEE);
      tracer_(sh, r, 'promu·e depuis la liste d\'attente → ' + ST.RESERVEE);
      SpreadsheetApp.flush();

      envoyerEmailPaiement_(p);
      notifierAdmin_('Promotion depuis la liste d\'attente',
        p.prenom + ' ' + p.nom + ' (' + p.email + ', ligne ' + r + ') a obtenu une place.\n' +
        'Les informations de paiement lui ont été envoyées.');
      return p;
    }
    return null;

  } finally {
    lock.releaseLock();
  }
}

function compterParStatut_(sh, statut, session) {
  var dernier = sh.getLastRow();
  if (dernier < 2) return 0;
  var n = dernier - 1;
  var stats = sh.getRange(2, COL.STATUT,  n, 1).getValues();
  var sess  = sh.getRange(2, COL.SESSION, n, 1).getValues();
  var cible = session || CONFIG.SESSION_ID, t = 0;
  for (var i = 0; i < n; i++) {
    var sn = String(sess[i][0] || '').trim();
    if (sn && sn !== cible) continue;
    if (String(stats[i][0] || '').trim().toUpperCase() === statut) t++;
  }
  return t;
}


/* ==========================================================================
   6. INSTALLATION — à lancer une fois depuis l'éditeur
   ========================================================================== */

/**
 * Crée l'onglet, les en-têtes, les cases à cocher, la validation de statut
 * et la mise en forme conditionnelle. Relançable sans risque.
 */
function initialiserFeuille() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(CONFIG.SHEET_NAME) || ss.insertSheet(CONFIG.SHEET_NAME);

  /* En-têtes */
  sh.getRange(1, 1, 1, LAST_COL).setValues([HEADERS])
    .setFontWeight('bold').setBackground('#14213D').setFontColor('#F7F1E3')
    .setVerticalAlignment('middle').setWrap(true);
  sh.setRowHeight(1, 44);
  sh.setFrozenRows(1);

  /* Largeurs lisibles */
  var largeurs = [150,110,110,220,180,320,90,110,270,110,150,140,170,240,140,180,300];
  for (var i = 0; i < largeurs.length; i++) sh.setColumnWidth(i + 1, largeurs[i]);

  var lignes = Math.max(sh.getMaxRows() - 1, 500);

  /* Liste déroulante de statuts : évite les fautes de frappe, qui
     fausseraient silencieusement le comptage des places. */
  var rgStatut = sh.getRange(2, COL.STATUT, lignes, 1);
  rgStatut.setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList([ST.RESERVEE, ST.PAYE, ST.ANNULEE, ST.IMPAYE, ST.ATTENTE], true)
      .setAllowInvalid(false)
      .setHelpText('Choisir un statut dans la liste.')
      .build());

  /* Cases à cocher */
  sh.getRange(2, COL.PAIEMENT_RECU,  lignes, 1).insertCheckboxes();
  sh.getRange(2, COL.CONFIRM_ENVOYEE, lignes, 1).insertCheckboxes();

  /* Formats de date */
  sh.getRange(2, COL.DATE_INSCRIPTION, lignes, 1).setNumberFormat('dd.MM.yyyy HH:mm');
  sh.getRange(2, COL.DATE_PAIEMENT,    lignes, 1).setNumberFormat('dd.MM.yyyy HH:mm');
  sh.getRange(2, COL.DATE_CONFIRM,     lignes, 1).setNumberFormat('dd.MM.yyyy HH:mm');

  /* Mise en forme conditionnelle sur toute la ligne, pilotée par le statut. */
  var plage  = sh.getRange(2, 1, lignes, LAST_COL);
  var colLet = colonneEnLettre_(COL.STATUT);
  function regle(statut, fond, texte) {
    return SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$' + colLet + '2="' + statut + '"')
      .setBackground(fond).setFontColor(texte)
      .setRanges([plage]).build();
  }
  sh.setConditionalFormatRules([
    regle(ST.PAYE,     '#D6F5DC', '#0B5323'),  // vert
    regle(ST.RESERVEE, '#FDE6C9', '#7A3E00'),  // orange
    regle(ST.ANNULEE,  '#FAD2CF', '#7A0C0C'),  // rouge
    regle(ST.IMPAYE,   '#FAD2CF', '#7A0C0C'),  // rouge
    regle(ST.ATTENTE,  '#E8EAED', '#3C4043')   // gris
  ]);

  SpreadsheetApp.getActive().toast('Feuille « ' + CONFIG.SHEET_NAME + ' » initialisée.');
}

/**
 * Installe le déclencheur onEdit installable (nécessaire pour envoyer des
 * e-mails : le onEdit simple n'en a pas le droit). À lancer une seule fois.
 */
function setupDeclencheurs() {
  var ss = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onEditInstallable') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onEditInstallable').forSpreadsheet(ss).onEdit().create();
  SpreadsheetApp.getActive().toast('Déclencheur onEdit installé.');
}

/** Installation complète en un appel. */
function installer() {
  initialiserFeuille();
  setupDeclencheurs();
}


/* ==========================================================================
   7. OUTILS
   ========================================================================== */

function nettoyer_(v, max) {
  var s = String(v == null ? '' : v);
  /* Retire les caractères de contrôle (le retour à la ligne reste permis
     dans le champ « attentes », qui est un texte long). */
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  /* Neutralise les débuts de formule : évite l'injection dans Sheets. */
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  if (max && s.length > max) s = s.substring(0, max);
  return s;
}

function emailValide_(m) {
  return /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(String(m || '')) && String(m).length <= 120;
}

function estCoche_(v) {
  var s = String(v == null ? '' : v).trim().toLowerCase();
  return s === 'oui' || s === 'on' || s === 'true' || s === '1' || s === 'yes';
}

function horodate_(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'dd.MM.yyyy HH:mm');
}

function colonneEnLettre_(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
  return s;
}

function alerte_(msg) {
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
}


/* ==========================================================================
   8. TESTS — à lancer depuis l'éditeur Apps Script
   ========================================================================== */

/** Simule une inscription complète (écrit vraiment + envoie vraiment). */
function testInscription() {
  var faux = { postData: { type: 'text/plain', contents: JSON.stringify({
    prenom: 'Test', nom: 'Curcuma', email: CONFIG.ADMIN_EMAIL,
    entreprise: 'Agence Curcuma', attentes: 'Vérifier que tout fonctionne.',
    newsletter: 'oui', consentement: 'oui', session: CONFIG.SESSION_ID, site_web: ''
  })}};
  Logger.log(doPost(faux).getContent());
}

/** Vérifie le comptage sans rien écrire. */
function testComptage() {
  var sh = getSheet_();
  Logger.log('Actives : ' + compterPlacesActives_(sh, CONFIG.SESSION_ID) + ' / ' + CONFIG.PLACES_MAX);
  Logger.log('Attente : ' + compterParStatut_(sh, ST.ATTENTE, CONFIG.SESSION_ID));
}

/** Vérifie qu'un e-mail invalide est bien refusé. */
function testEmailInvalide() {
  var faux = { postData: { type: 'text/plain', contents: JSON.stringify({
    prenom: 'Test', nom: 'Invalide', email: 'pas-un-email', consentement: 'oui'
  })}};
  Logger.log(doPost(faux).getContent());   // attendu : {"status":"ERREUR",...}
}

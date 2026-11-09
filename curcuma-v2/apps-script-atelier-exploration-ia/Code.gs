/**
 * ============================================================================
 *  AGENCE CURCUMA — Atelier Exploration IA (Google Apps Script)
 *  Backend de la page atelier-exploration-ia.html
 *
 *  - reçoit les inscriptions (une date au choix parmi les sessions),
 *  - 4 places par date ; une place est RÉSERVÉE 72 h, puis CONFIRMÉE
 *    au paiement (ou à la prise en charge cochée par Eve),
 *  - au-delà de 4 places occupées : liste d'attente,
 *  - réservation non payée après 72 h : la personne repasse en liste
 *    d'attente dès que quelqu'un d'autre attend (ou s'inscrit),
 *  - e-mail avec facture PDF + bulletin QR suisse au nom de la personne,
 *  - événement de la journée tenu à jour dans l'agenda d'Eve,
 *  - e-mail à Eve quand une date est complète (4 confirmées).
 *
 *  Installation : voir ATELIER-IA-mode-emploi.md (même dossier).
 * ============================================================================
 */

/* ==========================================================================
   1. CONFIGURATION
   ========================================================================== */
var CONFIG = {

  SHEET_NAME : 'Inscriptions',
  PLACES_MAX : 4,        // places par date
  PLACES_MIN : 2,        // minimum pour maintenir la journée
  RESERVATION_HEURES : 72,
  ALERTE_MINIMUM_JOURS : 7,   // Eve est prévenue X jours avant si < PLACES_MIN confirmées

  /* Dates proposées. Ajouter une ligne suffit pour ouvrir une nouvelle date
     (et l'ajouter aussi dans atelier-exploration-ia.html, tableau SESSIONS). */
  SESSIONS : [
    { id: 'JIA-2026-12-10', date: '2026-12-10', label: 'jeudi 10 décembre 2026' },
    { id: 'JIA-2027-01-14', date: '2027-01-14', label: 'jeudi 14 janvier 2027' },
    { id: 'JIA-2027-02-11', date: '2027-02-11', label: 'jeudi 11 février 2027' }
  ],
  HEURE_DEBUT : '08:30',
  HEURE_FIN   : '17:00',
  /* Les inscriptions d'une date ferment la veille à cette heure. */
  CLOTURE_VEILLE_HEURE : '12:00',
  FUSEAU : 'Europe/Zurich',

  TITRE       : 'Atelier Exploration IA',
  LIEU_LIGNE1 : 'Au Bévan 11b',
  LIEU_LIGNE2 : '2852 Courtételle',
  URL_PAGE    : 'https://www.agence-curcuma.ch/atelier-exploration-ia.html',
  /* Accès, repris dans les e-mails */
  ACCES       : 'Places de parc visiteurs sur place, parc à vélos, arrêt de bus à proximité (Courtételle, Courtemelon).',
  MAPS        : 'https://www.google.com/maps/search/?api=1&query=Au+B%C3%A9van+11b%2C+2852+Court%C3%A9telle',
  RAPPEL_JOURS: 7,   // e-mail de rappel aux personnes confirmées

  /* --- Facturation --------------------------------------------------- */
  PRIX     : 600,
  DEVISE   : 'CHF',
  IBAN     : 'CH04 0840 1000 0785 4260 0',
  CREANCIER: {
    nom: 'Agence Curcuma - Eve Schaller',
    rue: 'Place de la Gare', numero: '12',
    npa: '2800', localite: 'Delémont', pays: 'CH'
  },
  MENTION_TVA : 'Agence Curcuma n\'est pas assujettie à la TVA.',
  PREFIXE_FACTURE : 'JIA',
  DOSSIER_FACTURES : 'Atelier Exploration IA — factures',   // dossier Google Drive (créé au besoin)

  /* --- E-mails ------------------------------------------------------- */
  ADMIN_EMAIL    : 'eve@agence-curcuma.ch',
  EXPEDITEUR_NOM : 'Eve Schaller · Agence Curcuma',
  REPLY_TO       : 'eve@agence-curcuma.ch',

  /* --- Agenda -------------------------------------------------------- */
  /* Vide = agenda principal du compte qui exécute le script
     (créer la feuille avec eve@agence-curcuma.ch → agenda pro). */
  CALENDAR_ID : ''
};

var ST = {
  RESERVEE : 'RESERVEE_72H',     // facture envoyée, paiement attendu
  PAYEE    : 'PAYEE',            // confirmée
  PEC      : 'PRISE_EN_CHARGE',  // confirmée sans attendre le paiement (courrier ORP)
  ATTENTE  : 'LISTE_ATTENTE',
  PREINSCR : 'PREINSCRIPTION_ORP', // chômage, ORP pas encore validé : ni place ni facture
  DESACTIVEE: 'DESACTIVEE',        // réservation non payée cédée à quelqu'un d'autre ; réactivable par lien
  ANNULEE  : 'ANNULEE'
};
var STATUTS_ACTIFS     = [ST.RESERVEE, ST.PAYEE, ST.PEC];   // occupent une place
var STATUTS_CONFIRMES  = [ST.PAYEE, ST.PEC];

var COL = {
  DATE: 1, SESSION: 2, DATE_COURS: 3, PRENOM: 4, NOM: 5, EMAIL: 6,
  RUE: 7, NPA: 8, LOCALITE: 9, ATTENTES: 10, NEWSLETTER: 11, CONSENTEMENT: 12,
  CHOMAGE: 13, CAISSE: 14, VALIDATION_ORP: 15,
  STATUT: 16, RESERVEE_JUSQU: 17, PAIEMENT_RECU: 18, DATE_PAIEMENT: 19,
  FACTURE: 20, CONFIRM_ENVOYEE: 21, ENTREE_ATTENTE: 22, NOTES: 23, HISTORIQUE: 24, CODE: 25
};
var HEADERS = [
  "Date d'inscription", 'Session', 'Date du cours', 'Prénom', 'Nom', 'E-mail',
  'Rue et n°', 'NPA', 'Localité', 'Ce que la personne aimerait faire', 'Newsletter', 'Conditions acceptées',
  'Via le chômage', 'Caisse de chômage', 'ORP : formation déjà validée ?',
  'Statut', "Réservée jusqu'au", 'Paiement reçu', 'Date de paiement', 'N° de facture',
  'Confirmation envoyée', "Entrée en liste d'attente", 'Notes', 'Historique', 'Code de réactivation'
];
var LAST_COL = HEADERS.length;


/* ==========================================================================
   2. POINTS D'ENTRÉE WEB
   ========================================================================== */

/** État des places pour le calendrier de la page. */
function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'reactiver') return reactiver_(e.parameter.code);
  try {
    var sh = getSheet_();
    var lignes = lireTout_(sh);
    var maintenant = new Date();
    return json_({
      status: 'OK',
      places_max: CONFIG.PLACES_MAX,
      sessions: CONFIG.SESSIONS.map(function (s) {
        var actives = compter_(lignes, s.id, STATUTS_ACTIFS);
        return {
          id: s.id, date: s.date, label: s.label,
          places_restantes: Math.max(0, CONFIG.PLACES_MAX - actives),
          liste_attente: actives >= CONFIG.PLACES_MAX,
          complet: compter_(lignes, s.id, STATUTS_CONFIRMES) >= CONFIG.PLACES_MAX,
          ouverte: maintenant < clotureSession_(s)
        };
      })
    });
  } catch (err) {
    return json_({ status: 'ERREUR', message: String(err) });
  }
}

function doPost(e) {
  try {
    var data = lireRequete_(e);
    if (nettoyer_(data.site_web)) return json_({ status: 'INSCRIT' });   // robot

    var p = {
      session   : nettoyer_(data.session, 40),
      prenom    : nettoyer_(data.prenom, 70),
      nom       : nettoyer_(data.nom, 70),
      email     : nettoyer_(data.email, 120).toLowerCase(),
      rue       : nettoyer_(data.rue, 70),
      npa       : nettoyer_(data.npa, 16),
      localite  : nettoyer_(data.localite, 35),
      attentes  : nettoyer_(data.attentes, 2000),
      newsletter: estCoche_(data.newsletter) ? 'oui' : 'non',
      consentement: estCoche_(data.consentement) ? 'oui' : 'non',
      chomage   : estCoche_(data.chomage) ? 'oui' : 'non',
      caisse    : nettoyer_(data.caisse, 80),
      validation: nettoyer_(data.validation_orp, 20)
    };
    if (p.chomage !== 'oui') { p.caisse = ''; p.validation = ''; }
    var preinscription = p.chomage === 'oui' && p.validation !== 'oui';
    var s = trouverSession_(p.session);
    if (!s) return json_({ status: 'ERREUR', message: 'Merci de choisir une date.' });
    if (new Date() >= clotureSession_(s)) {
      return json_({ status: 'ERREUR', message: 'Les inscriptions pour cette date sont fermées.' });
    }
    if (!p.prenom || !p.nom) return json_({ status: 'ERREUR', message: 'Le prénom et le nom sont obligatoires.' });
    if (!emailValide_(p.email)) return json_({ status: 'ERREUR', message: 'Adresse e-mail invalide.' });
    if (!p.rue || !p.npa || !p.localite) {
      return json_({ status: 'ERREUR', message: 'Merci d\'indiquer votre adresse : elle figure sur la facture.' });
    }
    if (p.chomage === 'oui' && !p.caisse) {
      return json_({ status: 'ERREUR', message: 'Merci d\'indiquer votre caisse de chômage.' });
    }
    if (p.chomage === 'oui' && p.validation !== 'oui' && p.validation !== 'pas encore') {
      return json_({ status: 'ERREUR', message: 'Merci d\'indiquer si l\'ORP a déjà validé la formation.' });
    }
    if (p.consentement !== 'oui') return json_({ status: 'ERREUR', message: 'L\'acceptation des conditions est nécessaire.' });

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return json_({ status: 'ERREUR', message: 'Service momentanément occupé, merci de réessayer.' });

    var res, expires = [];
    try {
      var sh = getSheet_();
      var lignes = lireTout_(sh);
      if (lignes.some(function (l) { return l.session === s.id && l.email === p.email && l.statut !== ST.ANNULEE && l.statut !== ST.DESACTIVEE; })) {
        return json_({ status: 'DOUBLON' });
      }
      /* ORP pas encore d'accord : pré-inscription, sans place ni facture. */
      if (preinscription) {
        var rp = ecrireInscription_(sh, p, s, ST.PREINSCR);
        res = { ligne: rp, statut: ST.PREINSCR, actives: compter_(lignes, s.id, STATUTS_ACTIFS) };
      }
      /* Date pleine : les réservations échues (72 h dépassées, non payées)
         cèdent leur place. Les personnes déjà en liste d'attente passent
         avant la nouvelle inscription. */
      if (!res && compter_(lignes, s.id, STATUTS_ACTIFS) >= CONFIG.PLACES_MAX) {
        expires = expirerEchues_(sh, lignes, s.id, 99);
        if (expires.length) promouvoir_(sh, s.id, expires.map(function (x) { return x.ligne; }));
        lignes = lireTout_(sh);
      }
      if (!res) {
        var actives = compter_(lignes, s.id, STATUTS_ACTIFS);
        var statut = actives < CONFIG.PLACES_MAX ? ST.RESERVEE : ST.ATTENTE;
        var r = ecrireInscription_(sh, p, s, statut);
        res = { ligne: r, statut: statut, actives: actives };
        if (statut === ST.RESERVEE) attribuerPlace_(sh, r, false);
      }
    } finally {
      lock.releaseLock();
    }

    expires.forEach(function (x) { emailExpiration_(x); });

    if (res.statut === ST.RESERVEE) {
      notifierAdmin_('Nouvelle inscription' + (p.chomage === 'oui' ? ' (chômage)' : '') + ' — ' + s.label,
        resumeAdmin_(p, s, ST.RESERVEE, res.actives + 1, res.ligne));
      majAgenda_(s.id);
      return json_({ status: 'INSCRIT', places_restantes: Math.max(0, CONFIG.PLACES_MAX - res.actives - 1) });
    }
    if (res.statut === ST.PREINSCR) {
      emailPreinscription_(p, s);
      notifierAdmin_('Pré-inscription (ORP pas encore validé) — ' + s.label, resumeAdmin_(p, s, ST.PREINSCR, res.actives, res.ligne));
      majAgenda_(s.id);
      return json_({ status: 'PREINSCRIT' });
    }
    emailListeAttente_(p, s);
    notifierAdmin_('Liste d\'attente — ' + s.label, resumeAdmin_(p, s, ST.ATTENTE, res.actives, res.ligne));
    majAgenda_(s.id);
    return json_({ status: 'LISTE_ATTENTE' });

  } catch (err) {
    try { notifierAdmin_('⚠️ Erreur inscription Atelier IA', String(err) + '\n\n' + (err && err.stack || '')); } catch (e2) {}
    return json_({ status: 'ERREUR', message: 'Une erreur est survenue. Veuillez réessayer ou écrire à eve@agence-curcuma.ch.' });
  }
}


/**
 * Lien de réactivation (e-mail « inscription annulée ») : place libre →
 * nouvelle réservation 72 h avec facture ; sinon → liste d'attente.
 */
function reactiver_(code) {
  var msg, titre = 'Réactivation';
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return pageReponse_('Un instant…', 'Le service est occupé. Merci de réessayer dans une minute.');
  var notif = null, l = null, s = null;
  try {
    var sh = getSheet_();
    code = String(code || '').replace(/[^a-f0-9]/gi, '');
    l = code ? lireTout_(sh).filter(function (x) { return x.code === code; })[0] : null;
    s = l ? trouverSession_(l.session) : null;
    if (!l || !s) {
      msg = ['Lien inconnu', 'Ce lien n\'est pas valable. Écrivez-moi à ' + CONFIG.ADMIN_EMAIL + ', je regarde avec vous.'];
    } else if (l.statut !== ST.DESACTIVEE) {
      msg = ['C\'est déjà fait', 'Votre inscription au ' + s.label + ' est déjà active (' + libelleStatut_(l.statut) + '). Rien d\'autre à faire.'];
    } else if (new Date() >= clotureSession_(s)) {
      msg = ['Inscriptions fermées', 'Les inscriptions pour le ' + s.label + ' sont fermées. Les prochaines dates sont sur ' + CONFIG.URL_PAGE];
    } else {
      var libres = CONFIG.PLACES_MAX - compter_(lireTout_(sh), s.id, STATUTS_ACTIFS);
      tracer_(sh, l.ligne, 'inscription réactivée par la personne (lien)');
      if (libres > 0) {
        attribuerPlace_(sh, l.ligne, false);
        msg = ['Inscription réactivée', 'Votre place au ' + s.label + ' est à nouveau réservée pour ' + CONFIG.RESERVATION_HEURES +
          ' heures. Vous recevez la facture par e-mail dans quelques minutes.'];
        notif = 'place réservée à nouveau (facture renvoyée)';
      } else {
        sh.getRange(l.ligne, COL.STATUT).setValue(ST.ATTENTE);
        sh.getRange(l.ligne, COL.ENTREE_ATTENTE).setValue(new Date());
        msg = ['Vous êtes en liste d\'attente', 'Les ' + CONFIG.PLACES_MAX + ' places du ' + s.label + ' sont prises. Votre inscription est ' +
          'réactivée en liste d\'attente : dès qu\'une place se libère, elle vous est attribuée avec la facture.'];
        notif = 'liste d\'attente (date complète)';
      }
      SpreadsheetApp.flush();
    }
  } finally {
    lock.releaseLock();
  }
  if (notif) {
    notifierAdmin_('Inscription réactivée — ' + s.label, l.prenom + ' ' + l.nom + ' (' + l.email + ') : ' + notif + '.');
    majAgenda_(s.id);
  }
  return pageReponse_(msg[0], msg[1]);
}

function libelleStatut_(st) {
  return ({ RESERVEE_72H: 'place réservée', PAYEE: 'place confirmée', PRISE_EN_CHARGE: 'place confirmée',
    LISTE_ATTENTE: 'liste d\'attente', PREINSCRIPTION_ORP: 'pré-inscription', ANNULEE: 'annulée' })[st] || st;
}

/** Petite page de réponse aux couleurs du site. */
function pageReponse_(titre, texte) {
  var esc = function (x) { return String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;'); };
  var html = '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;800&display=swap" rel="stylesheet"></head>' +
    '<body style="margin:0;background:#f7f1e3;font-family:Barlow,Arial,sans-serif;color:#14213d">' +
    '<div style="max-width:560px;margin:12vh auto;padding:32px 24px;background:#14213d;border-radius:28px;color:#f7f1e3">' +
    '<p style="margin:0 0 12px;color:#f2ff49;font-weight:800;letter-spacing:.18em;text-transform:uppercase;font-size:12px">' + esc(CONFIG.TITRE) + '</p>' +
    '<h1 style="margin:0 0 14px;color:#fff;font-size:28px;line-height:1.15">' + esc(titre) + '</h1>' +
    '<p style="margin:0 0 22px;line-height:1.6;color:rgba(247,241,227,.85)">' + esc(texte) + '</p>' +
    '<a href="' + CONFIG.URL_PAGE + '" style="display:inline-block;background:#f2ff49;color:#14213d;font-weight:800;text-decoration:none;padding:12px 22px;border-radius:999px">Voir l\'atelier</a>' +
    '</div></body></html>';
  return HtmlService.createHtmlOutput(html).setTitle(CONFIG.TITRE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}


/* ==========================================================================
   3. RÈGLES DE GESTION
   ========================================================================== */

/**
 * Donne une place à la ligne r : statut RESERVEE, échéance 72 h,
 * numéro de facture, e-mail avec la facture PDF.
 * Appelée à l'inscription et lors d'une promotion depuis la liste d'attente.
 */
function attribuerPlace_(sh, r, promotion) {
  var l = lireLigne_(sh, r);
  var s = trouverSession_(l.session);
  var echeance = echeanceReservation_(s, new Date());
  var numero = l.facture || prochainNumeroFacture_();

  sh.getRange(r, COL.STATUT).setValue(ST.RESERVEE);
  sh.getRange(r, COL.RESERVEE_JUSQU).setValue(echeance);
  sh.getRange(r, COL.FACTURE).setValue(numero);
  tracer_(sh, r, (promotion ? 'promu·e depuis la liste d\'attente' : 'place réservée') +
    ' jusqu\'au ' + horodate_(echeance) + ' — facture ' + numero);
  SpreadsheetApp.flush();

  l.facture = numero;
  var pdf = factureBlob_(l, s, numero, new Date(), echeance);
  try { dossierFactures_().createFile(pdf.copyBlob()); } catch (e) {
    notifierAdmin_('⚠️ Facture non archivée', 'La facture ' + numero + ' n\'a pas pu être copiée dans Drive : ' + e);
  }
  emailFacture_(l, s, echeance, pdf, promotion);
}

/**
 * Passe en liste d'attente les réservations échues d'une session
 * (au plus `max`, les plus anciennes d'abord). Retourne les lignes
 * concernées, pour envoyer les e-mails hors verrou.
 */
function expirerEchues_(sh, lignes, sessionId, max) {
  var maintenant = new Date();
  var echues = lignes.filter(function (l) {
    return l.session === sessionId && l.statut === ST.RESERVEE && !l.paiementRecu && !l.chomage &&
      l.reserveeJusqu instanceof Date && l.reserveeJusqu < maintenant;
  }).sort(function (a, b) { return a.reserveeJusqu - b.reserveeJusqu; }).slice(0, max);

  echues.forEach(function (l) {
    l.code = l.code || Utilities.getUuid().replace(/-/g, '');
    sh.getRange(l.ligne, COL.STATUT).setValue(ST.DESACTIVEE);
    sh.getRange(l.ligne, COL.CODE).setValue(l.code);
    tracer_(sh, l.ligne, 'réservation échue sans paiement, place cédée → inscription désactivée');
  });
  if (echues.length) SpreadsheetApp.flush();
  return echues;
}

/** Donne les places libres d'une session aux premières personnes en attente. */
function promouvoir_(sh, sessionId, exclure) {
  var promus = [];
  var lignes = lireTout_(sh);
  var libres = CONFIG.PLACES_MAX - compter_(lignes, sessionId, STATUTS_ACTIFS);
  var file = fileAttente_(lignes, sessionId).filter(function (l) { return !exclure || exclure.indexOf(l.ligne) === -1; });
  for (var i = 0; i < file.length && libres > 0; i++, libres--) {
    attribuerPlace_(sh, file[i].ligne, true);
    promus.push(file[i]);
  }
  return promus;
}

/** Liste d'attente d'une session, dans l'ordre d'entrée. */
function fileAttente_(lignes, sessionId) {
  return lignes.filter(function (l) { return l.session === sessionId && l.statut === ST.ATTENTE; })
    .sort(function (a, b) {
      var da = a.entreeAttente instanceof Date ? a.entreeAttente : a.date;
      var db = b.entreeAttente instanceof Date ? b.entreeAttente : b.date;
      return da - db;
    });
}

/**
 * Confirme une place (paiement reçu ou prise en charge) : statut, e-mail
 * de confirmation avec le fichier agenda, agenda d'Eve, alerte « complet ».
 */
function confirmer_(sh, r, statutCible) {
  var l = lireLigne_(sh, r);
  var s = trouverSession_(l.session);
  if (!s || !l.email) return;

  var lignes = lireTout_(sh);
  var autres = lignes.filter(function (x) { return x.ligne !== r; });
  var dejaPlace = STATUTS_ACTIFS.indexOf(l.statut) !== -1;
  var occupees = compter_(autres, s.id, STATUTS_ACTIFS);

  /* Paiement d'une personne repassée en liste d'attente alors que la date
     est pleine : on n'écrase rien, Eve décide (remboursement ou report). */
  if (!dejaPlace && statutCible === ST.PAYEE && occupees >= CONFIG.PLACES_MAX) {
    sh.getRange(r, COL.DATE_PAIEMENT).setValue(new Date());
    tracer_(sh, r, 'paiement reçu alors que la date est pleine — à traiter');
    notifierAdmin_('⚠️ Paiement reçu mais date pleine — ' + s.label,
      l.prenom + ' ' + l.nom + ' (' + l.email + ', ligne ' + r + ') a payé, mais les ' + CONFIG.PLACES_MAX +
      ' places du ' + s.label + ' sont occupées.\n\nÀ toi de choisir : rembourser, ou lui proposer une autre date ' +
      '(changer la colonne Session puis cocher à nouveau « Paiement reçu »).');
    return;
  }
  if (statutCible === ST.PEC && l.chomage) sh.getRange(r, COL.VALIDATION_ORP).setValue('oui');
  /* ORP d'accord mais date pleine : la personne passe en liste d'attente
     (elle aura la prochaine place libre, comme les autres). */
  if (!dejaPlace && occupees >= CONFIG.PLACES_MAX) {
    sh.getRange(r, COL.STATUT).setValue(ST.ATTENTE);
    sh.getRange(r, COL.ENTREE_ATTENTE).setValue(new Date());
    tracer_(sh, r, 'validation ORP reçue mais date pleine → liste d\'attente');
    SpreadsheetApp.flush();
    emailListeAttente_(l, s);
    notifierAdmin_('Date pleine — ' + l.prenom + ' ' + l.nom + ' en liste d\'attente',
      'La validation de l\'ORP est notée, mais les ' + CONFIG.PLACES_MAX + ' places du ' + s.label + ' sont occupées.\n' +
      l.prenom + ' ' + l.nom + ' est en liste d\'attente et recevra la prochaine place libre.');
    majAgenda_(s.id);
    return;
  }
  /* Prise en charge sans facture encore envoyée (pré-inscription) :
     la facture part avec la confirmation, pour la caisse de chômage. */
  var factureJointe = null;
  if (statutCible === ST.PEC && !l.facture) {
    l.facture = prochainNumeroFacture_();
    sh.getRange(r, COL.FACTURE).setValue(l.facture);
    factureJointe = factureBlob_(l, s, l.facture, new Date(), new Date());
    try { dossierFactures_().createFile(factureJointe.copyBlob()); } catch (e) {}
  }

  var maintenant = new Date();
  sh.getRange(r, COL.STATUT).setValue(statutCible);
  if (statutCible === ST.PAYEE) {
    sh.getRange(r, COL.PAIEMENT_RECU).setValue(true);
    sh.getRange(r, COL.DATE_PAIEMENT).setValue(maintenant);
  }
  if (!l.facture) sh.getRange(r, COL.FACTURE).setValue(prochainNumeroFacture_());

  if (l.confirmEnvoyee) {
    tracer_(sh, r, 'statut → ' + statutCible + ' (confirmation déjà envoyée, pas de second e-mail)');
  } else {
    emailConfirmation_(l, s, factureJointe);
    sh.getRange(r, COL.CONFIRM_ENVOYEE).setValue(true);
    tracer_(sh, r, 'statut → ' + statutCible + ' + e-mail de confirmation envoyé');
  }
  SpreadsheetApp.flush();
  majAgenda_(s.id);
  verifierComplet_(sh, s);
}

/** Prévient Eve une seule fois quand une date atteint 4 places confirmées. */
function verifierComplet_(sh, s) {
  var lignes = lireTout_(sh);
  var conf = lignes.filter(function (l) { return l.session === s.id && STATUTS_CONFIRMES.indexOf(l.statut) !== -1; });
  var props = PropertiesService.getScriptProperties();
  var cle = 'complet_' + s.id;
  if (conf.length >= CONFIG.PLACES_MAX && !props.getProperty(cle)) {
    props.setProperty(cle, '1');
    var attente = fileAttente_(lignes, s.id).length;
    notifierAdmin_('✅ COMPLET — ' + s.label,
      'Les ' + CONFIG.PLACES_MAX + ' places du ' + s.label + ' sont confirmées :\n\n' +
      conf.map(function (l) { return '· ' + l.prenom + ' ' + l.nom + ' — ' + (l.statut === ST.PEC ? 'prise en charge' : 'payé'); }).join('\n') +
      '\n\nEn liste d\'attente : ' + attente + ' personne(s).');
  }
  if (conf.length < CONFIG.PLACES_MAX && props.getProperty(cle)) props.deleteProperty(cle);
}

/**
 * Déclencheur horaire : réservations échues, promotions, alerte minimum.
 */
function verifierEcheances() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  var aPrevenir = [], promus = [], touchees = {}, rappels = [];
  try {
    var sh = getSheet_();
    var props = PropertiesService.getScriptProperties();
    var maintenant = new Date();

    CONFIG.SESSIONS.forEach(function (s) {
      if (maintenant > debutSession_(s)) return;
      var lignes = lireTout_(sh);
      var attente = fileAttente_(lignes, s.id).length;

      /* Une réservation échue ne cède sa place que si quelqu'un attend. */
      if (attente > 0) {
        var ex = expirerEchues_(sh, lignes, s.id, attente);
        if (ex.length) { aPrevenir = aPrevenir.concat(ex); touchees[s.id] = 1; }
      } else {
        lignes.forEach(function (l) {
          var cle = 'retard_' + s.id + '_' + l.email;
          if (l.session === s.id && l.statut === ST.RESERVEE && !l.chomage && l.reserveeJusqu instanceof Date &&
              l.reserveeJusqu < maintenant && !props.getProperty(cle)) {
            props.setProperty(cle, '1');
            notifierAdmin_('Paiement en retard — ' + s.label,
              l.prenom + ' ' + l.nom + ' (' + l.email + ', ligne ' + l.ligne + ') n\'a pas payé dans les ' +
              CONFIG.RESERVATION_HEURES + ' h.\nPersonne n\'attend : sa place reste réservée. Son inscription sera ' +
              'désactivée automatiquement dès qu\'une autre personne voudra la place.');
          }
        });
      }
      var p = promouvoir_(sh, s.id);
      if (p.length) { promus = promus.concat(p); touchees[s.id] = 1; }

      /* Rappel aux personnes confirmées, une fois, à partir de J-7 */
      if ((debutSession_(s) - maintenant) / 86400000 <= CONFIG.RAPPEL_JOURS) {
        lireTout_(sh).forEach(function (l) {
          var cleR = 'rappel_' + s.id + '_' + l.email;
          if (l.session === s.id && STATUTS_CONFIRMES.indexOf(l.statut) !== -1 && !props.getProperty(cleR)) {
            props.setProperty(cleR, '1');
            rappels.push(l);
          }
        });
      }

      /* Minimum non atteint à J-7 */
      var cleMin = 'minimum_' + s.id;
      var jours = (debutSession_(s) - maintenant) / 86400000;
      if (jours <= CONFIG.ALERTE_MINIMUM_JOURS && !props.getProperty(cleMin)) {
        var conf = compter_(lireTout_(sh), s.id, STATUTS_CONFIRMES);
        if (conf < CONFIG.PLACES_MIN) {
          props.setProperty(cleMin, '1');
          notifierAdmin_('⚠️ Minimum pas atteint — ' + s.label,
            'À ' + Math.ceil(jours) + ' jours du ' + s.label + ', ' + conf + ' place(s) confirmée(s) sur ' +
            CONFIG.PLACES_MIN + ' minimum.\nÀ toi de décider : maintenir, ou annuler et proposer une autre date ' +
            '(remboursement intégral, selon les conditions).');
        }
      }
    });
  } finally {
    lock.releaseLock();
  }
  aPrevenir.forEach(function (x) { emailExpiration_(x); });
  rappels.forEach(function (x) { try { emailRappel_(x); } catch (e) { notifierAdmin_('⚠️ Rappel non envoyé', x.email + ' : ' + e); } });
  promus.forEach(function (x) {
    notifierAdmin_('Place réattribuée', x.prenom + ' ' + x.nom + ' (' + x.email + ') a reçu une place depuis la liste d\'attente et sa facture.');
  });
  Object.keys(touchees).forEach(majAgenda_);
}

/** Déclencheur « modification » de la feuille : actions d'Eve. */
function onEditInstallable(e) {
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet();
    if (sh.getName() !== CONFIG.SHEET_NAME) return;
    var r = e.range.getRow(), c = e.range.getColumn();
    if (r < 2 || e.range.getNumRows() > 1) return;

    if (c === COL.PAIEMENT_RECU && String(e.value).toUpperCase() === 'TRUE') {
      avecVerrou_(function () { confirmer_(sh, r, ST.PAYEE); });
      return;
    }
    if (c === COL.STATUT) {
      var nouveau = String(e.value || '').trim().toUpperCase();
      var ancien = String(e.oldValue || '').trim().toUpperCase();
      if (nouveau === ancien) return;
      tracer_(sh, r, 'statut modifié à la main : ' + (ancien || '—') + ' → ' + nouveau);
      var l = lireLigne_(sh, r);

      if (nouveau === ST.PEC || nouveau === ST.PAYEE) {
        /* Remet l'ancien statut le temps du contrôle de capacité. */
        sh.getRange(r, COL.STATUT).setValue(ancien);
        avecVerrou_(function () { confirmer_(sh, r, nouveau); });
        return;
      }
      if (nouveau === ST.ANNULEE && STATUTS_ACTIFS.indexOf(ancien) !== -1) {
        var promus = [];
        avecVerrou_(function () { promus = promouvoir_(sh, l.session); });
        verifierComplet_(sh, trouverSession_(l.session));
        majAgenda_(l.session);
        notifierAdmin_('Place libérée', l.prenom + ' ' + l.nom + ' annulé·e.' +
          (promus.length ? '\nPlace donnée à : ' + promus.map(function (x) { return x.prenom + ' ' + x.nom; }).join(', ') : ''));
      }
    }
  } catch (err) {
    notifierAdmin_('⚠️ Erreur dans la feuille Atelier IA', String(err) + '\n' + (err && err.stack || ''));
  }
}

function avecVerrou_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { fn(); } finally { lock.releaseLock(); }
}


/* ==========================================================================
   4. E-MAILS
   ========================================================================== */

function infosPratiques_(s) {
  return s.label.charAt(0).toUpperCase() + s.label.slice(1) + ', ' +
    horaire_() + '\n' +
    CONFIG.LIEU_LIGNE1 + ', ' + CONFIG.LIEU_LIGNE2 + '\n' +
    CONFIG.ACCES;
}

/** Lien personnel pour réactiver une inscription désactivée. */
function lienReactivation_(l) {
  return ScriptApp.getService().getUrl() + '?action=reactiver&code=' + encodeURIComponent(l.code);
}

function emailRappel_(l) {
  var s = trouverSession_(l.session);
  var corps =
    'Bonjour ' + l.prenom + ',\n\n' +
    'Plus qu\'une semaine avant l\'' + CONFIG.TITRE + ' ! Voici les informations pratiques.\n\n' +
    infosPratiques_(s) + '\n' +
    'Itinéraire : ' + CONFIG.MAPS + '\n\n' +
    'À prévoir : votre ordinateur portable et son chargeur, et votre abonnement Claude Pro actif (environ 20 CHF par mois). ' +
    'Le repas de midi, les boissons et les cafés sont offerts.\n\n' +
    'Pour gagner du temps l\'après-midi, pensez déjà à une tâche de votre quotidien que vous aimeriez confier à l\'IA.\n\n' +
    'Un empêchement ? Le délai d\'annulation est passé, mais vous pouvez vous faire remplacer par une autre personne, sans frais, jusqu\'à la veille. ' +
    'Répondez simplement à cet e-mail avec son nom et son adresse e-mail.\n\n' +
    'À bientôt,\nEve Schaller\nAgence Curcuma';
  envoyer_(l.email, 'Plus qu\'une semaine — ' + CONFIG.TITRE + ' du ' + s.label, corps, [icsBlob_(s)]);
}

function emailFacture_(l, s, echeance, pdf, promotion) {
  var corps =
    'Bonjour ' + l.prenom + ',\n\n' +
    (promotion
      ? 'Bonne nouvelle : une place s\'est libérée pour l\'' + CONFIG.TITRE + ' du ' + s.label + '. Elle est à vous.\n\n'
      : 'Merci pour votre inscription à l\'' + CONFIG.TITRE + ' du ' + s.label + '.\n\n') +
    infosPratiques_(s) + '\n\n' +
    (l.chomage
      ? 'Vous trouverez la facture en pièce jointe : merci de la transmettre à votre caisse de chômage (' + l.caisse + '). ' +
        'Votre place vous est gardée et je la confirme dès que je reçois le courrier de l\'ORP.\n\n'
      : 'Votre place est réservée jusqu\'au ' + dateLongue_(echeance) + '. Elle est confirmée dès réception de votre paiement de ' +
        montantTexte_() + '.\n\n' +
        'Vous trouverez la facture en pièce jointe. Le bulletin QR en bas de page se scanne directement avec l\'application de votre banque.\n\n' +
        'Sans paiement à cette date, la place est proposée à la personne suivante et votre inscription passe en liste d\'attente.\n\n') +
    'À prévoir pour la journée : votre ordinateur portable et un abonnement Claude Pro (environ 20 CHF par mois). Le repas de midi, les boissons et les cafés sont offerts.\n\n' +
    'Une question ? Répondez simplement à cet e-mail.\n\n' +
    'À bientôt,\nEve Schaller\nAgence Curcuma';
  envoyer_(l.email,
    (promotion ? 'Une place s\'est libérée — ' : 'Votre inscription — ') + CONFIG.TITRE + ' du ' + s.label,
    corps, [pdf]);
}

function emailConfirmation_(l, s, facture) {
  var corps =
    'Bonjour ' + l.prenom + ',\n\n' +
    'Votre place à l\'' + CONFIG.TITRE + ' est confirmée. Je me réjouis de vous accueillir !\n\n' +
    infosPratiques_(s) + '\n\n' +
    'Itinéraire : ' + CONFIG.MAPS + '\n\n' +
    'Le fichier joint ajoute la journée à votre agenda.\n\n' +
    (facture ? 'Vous trouverez aussi la facture, à transmettre à votre caisse de chômage.\n\n' : '') +
    'À prévoir : votre ordinateur portable et votre abonnement Claude Pro actif (environ 20 CHF par mois). ' +
    'Le repas de midi, les boissons et les cafés sont offerts. Vous repartez avec une attestation de participation.\n\n' +
    'Je vous envoie un rappel une semaine avant.\n\n' +
    'À bientôt,\nEve Schaller\nAgence Curcuma';
  envoyer_(l.email, 'Votre place est confirmée — ' + CONFIG.TITRE + ' du ' + s.label, corps, facture ? [icsBlob_(s), facture] : [icsBlob_(s)]);
}

function emailPreinscription_(l, s) {
  var corps =
    'Bonjour ' + l.prenom + ',\n\n' +
    'Merci pour votre pré-inscription à l\'' + CONFIG.TITRE + ' du ' + s.label + '.\n\n' +
    'Comme votre participation passe par le chômage, votre inscription devient définitive une fois que l\'ORP a validé la formation. ' +
    'D\'ici là, aucune place n\'est bloquée et aucun paiement ne vous est demandé.\n\n' +
    'Dès que je reçois la validation de l\'ORP, je vous confirme votre place (s\'il en reste une), avec la facture à transmettre à votre caisse. ' +
    'Si la date est complète, vous passez en liste d\'attente ou sur une date suivante.\n\n' +
    'À bientôt,\nEve Schaller\nAgence Curcuma';
  envoyer_(l.email, 'Votre pré-inscription — ' + CONFIG.TITRE + ' du ' + s.label, corps);
}

function emailListeAttente_(l, s) {
  var corps =
    'Bonjour ' + l.prenom + ',\n\n' +
    'Merci pour votre intérêt pour l\'' + CONFIG.TITRE + ' du ' + s.label + '.\n\n' +
    'Les ' + CONFIG.PLACES_MAX + ' places de cette date sont prises pour l\'instant. Vous êtes inscrit·e en liste d\'attente.\n\n' +
    'Dès qu\'une place se libère, vous la recevez automatiquement, avec la facture, dans l\'ordre d\'arrivée. ' +
    'Aucun paiement ne vous est demandé d\'ici là.\n\n' +
    'Vous préférez une autre date ? Les prochaines sont sur ' + CONFIG.URL_PAGE + '\n\n' +
    'À bientôt,\nEve Schaller\nAgence Curcuma';
  envoyer_(l.email, 'Liste d\'attente — ' + CONFIG.TITRE + ' du ' + s.label, corps);
}

function emailExpiration_(l) {
  var s = trouverSession_(l.session);
  if (!s) return;
  var corps =
    'Bonjour ' + l.prenom + ',\n\n' +
    'Je n\'ai pas reçu votre paiement pour l\'' + CONFIG.TITRE + ' du ' + s.label + ' dans le délai de ' +
    CONFIG.RESERVATION_HEURES + ' heures. Comme une autre personne souhaitait la place, elle lui a été attribuée ' +
    'et votre inscription est annulée.\n\n' +
    'Vous souhaitez toujours venir ? Réactivez votre inscription en un clic :\n' + lienReactivation_(l) + '\n\n' +
    'S\'il reste une place, elle vous est réservée à nouveau pour ' + CONFIG.RESERVATION_HEURES + ' heures, avec votre facture. ' +
    'Sinon, vous êtes inscrit·e en liste d\'attente.\n\n' +
    'Vous avez déjà payé ? Répondez simplement à cet e-mail, nous trouvons une solution.\n\n' +
    'À bientôt,\nEve Schaller\nAgence Curcuma';
  envoyer_(l.email, 'Inscription annulée — ' + CONFIG.TITRE + ' du ' + s.label, corps);
}

function notifierAdmin_(sujet, corps) {
  if (!CONFIG.ADMIN_EMAIL) return;
  try {
    MailApp.sendEmail({ to: CONFIG.ADMIN_EMAIL, subject: '[Atelier IA] ' + sujet, body: corps, name: 'Inscriptions Atelier IA' });
  } catch (e) {}
}

function envoyer_(to, sujet, corps, pj) {
  var o = { to: to, subject: sujet, body: corps, name: CONFIG.EXPEDITEUR_NOM, replyTo: CONFIG.REPLY_TO };
  if (pj && pj.length) o.attachments = pj;
  MailApp.sendEmail(o);
}

function resumeAdmin_(p, s, statut, actives, ligne) {
  return [
    'Date : ' + s.label, 'Statut : ' + statut, 'Ligne : ' + ligne, '',
    p.prenom + ' ' + p.nom + ' <' + p.email + '>',
    p.rue + ', ' + p.npa + ' ' + p.localite,
    p.chomage === 'oui' ? 'VIA LE CHÔMAGE — caisse : ' + p.caisse + ' — ORP a déjà validé : ' + (p.validation || '?') +
      (p.validation === 'oui' ? '\n→ place gardée sans délai ; mets PRISE_EN_CHARGE à réception du courrier de l\'ORP.'
        : '\n→ PRÉ-INSCRIPTION : aucune place bloquée. À réception de la validation de l\'ORP, mets PRISE_EN_CHARGE : la place est confirmée si elle est libre (facture jointe), sinon liste d\'attente.')
      : 'Paiement personnel (72 h)',
    '',
    'Ce que la personne aimerait faire :', (p.attentes || '—'), '',
    'Places occupées : ' + actives + ' / ' + CONFIG.PLACES_MAX
  ].join('\n');
}


/* ==========================================================================
   5. AGENDA D'EVE
   ========================================================================== */

function agenda_() {
  return CONFIG.CALENDAR_ID ? CalendarApp.getCalendarById(CONFIG.CALENDAR_ID) : CalendarApp.getDefaultCalendar();
}

/** Crée (une fois) l'événement de la journée, puis met à jour titre et description. */
function majAgenda_(sessionId) {
  try {
    var s = trouverSession_(sessionId);
    if (!s) return;
    var props = PropertiesService.getScriptProperties();
    var cle = 'evt_' + s.id, ev = null, id = props.getProperty(cle);
    if (id) { try { ev = agenda_().getEventById(id); } catch (e) { ev = null; } }
    if (!ev) {
      ev = agenda_().createEvent(CONFIG.TITRE, debutSession_(s), finSession_(s), { location: CONFIG.LIEU_LIGNE1 + ', ' + CONFIG.LIEU_LIGNE2 });
      props.setProperty(cle, ev.getId());
    }
    var lignes = lireTout_(getSheet_()).filter(function (l) { return l.session === s.id; });
    var conf = lignes.filter(function (l) { return STATUTS_CONFIRMES.indexOf(l.statut) !== -1; });
    var res = lignes.filter(function (l) { return l.statut === ST.RESERVEE; });
    var att = fileAttente_(lignes, s.id);
    var pre = lignes.filter(function (l) { return l.statut === ST.PREINSCR; });
    ev.setTitle(CONFIG.TITRE + ' — ' + conf.length + '/' + CONFIG.PLACES_MAX + ' confirmées' + (res.length ? ' (+' + res.length + ' en attente de paiement)' : ''));
    ev.setDescription(
      'Confirmées :\n' + (conf.map(function (l) { return '· ' + l.prenom + ' ' + l.nom + (l.statut === ST.PEC ? ' (prise en charge)' : ''); }).join('\n') || '—') +
      '\n\nRéservées, paiement attendu :\n' + (res.map(function (l) { return '· ' + l.prenom + ' ' + l.nom + (l.chomage ? ' (chômage, en attente de l\'ORP)' : ' (jusqu\'au ' + horodate_(l.reserveeJusqu) + ')'); }).join('\n') || '—') +
      '\n\nListe d\'attente :\n' + (att.map(function (l) { return '· ' + l.prenom + ' ' + l.nom; }).join('\n') || '—') +
      '\n\nPré-inscriptions (ORP pas encore validé) :\n' + (pre.map(function (l) { return '· ' + l.prenom + ' ' + l.nom + ' — ' + l.caisse; }).join('\n') || '—') +
      '\n\nInscriptions désactivées (jamais payées, réactivables) :\n' + (lignes.filter(function (l) { return l.statut === ST.DESACTIVEE; }).map(function (l) { return '· ' + l.prenom + ' ' + l.nom; }).join('\n') || '—') +
      '\n\nMis à jour automatiquement depuis la feuille d\'inscriptions.');
  } catch (err) {
    notifierAdmin_('⚠️ Agenda non mis à jour', String(err));
  }
}

/** Fichier .ics joint à la confirmation (le participant l'ajoute à son agenda). */
function icsBlob_(s) {
  var f = function (d) { return Utilities.formatDate(d, 'UTC', "yyyyMMdd'T'HHmmss'Z'"); };
  var ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Agence Curcuma//Atelier Exploration IA//FR', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:' + s.id + '@agence-curcuma.ch',
    'DTSTAMP:' + f(new Date()),
    'DTSTART:' + f(debutSession_(s)),
    'DTEND:' + f(finSession_(s)),
    'SUMMARY:' + CONFIG.TITRE + ' — Agence Curcuma',
    'LOCATION:' + (CONFIG.LIEU_LIGNE1 + '\\, ' + CONFIG.LIEU_LIGNE2),
    'DESCRIPTION:Repas de midi\\, boissons et cafés offerts. À prévoir : abonnement Claude Pro actif. Contact : ' + CONFIG.ADMIN_EMAIL,
    'END:VEVENT', 'END:VCALENDAR'
  ].join('\r\n');
  return Utilities.newBlob(ics, 'text/calendar', 'atelier-exploration-ia.ics');
}


/* ==========================================================================
   6. FACTURE PDF AVEC BULLETIN QR SUISSE
   ========================================================================== */

function factureBlob_(l, s, numero, dateFacture, echeance) {
  var octets = facturePdf_({
    numero: numero, date: dateFacture, echeance: echeance, session: s,
    client: { prenom: l.prenom, nom: l.nom, rue: l.rue, npa: l.npa, localite: l.localite },
    chomage: !!l.chomage, caisse: l.caisse || ''
  });
  var signes = octets.map(function (b) { return b > 127 ? b - 256 : b; });
  return Utilities.newBlob(signes, 'application/pdf', 'Facture ' + numero + ' - ' + l.prenom + ' ' + l.nom + '.pdf');
}

/** Contenu du QR suisse (Swiss Payments Code, version 0200). */
function payloadQr_(d) {
  var c = CONFIG.CREANCIER, k = d.client;
  var nomDebiteur = (k.prenom + ' ' + k.nom).substring(0, 70);
  var adr = decouperAdresse_(k.rue);
  return [
    'SPC', '0200', '1',
    CONFIG.IBAN.replace(/\s/g, ''),
    'S', c.nom, c.rue, c.numero, c.npa, c.localite, c.pays,
    '', '', '', '', '', '', '',                     // créancier final (inutilisé)
    montantQr_(), CONFIG.DEVISE,
    'S', nomDebiteur, adr.rue.substring(0, 70), adr.numero.substring(0, 16), k.npa.substring(0, 16), k.localite.substring(0, 35), 'CH',
    'NON', '',
    messageQr_(d),
    'EPD'
  ].map(qrTexte_).join('\n');
}

function messageQr_(d) {
  return ('Atelier IA ' + dateCourte_(debutSession_(d.session)) +
    ' - ' + d.client.prenom + ' ' + d.client.nom + ' - Facture ' + d.numero).substring(0, 140);
}

/** Sépare « Rue du Moulin 12a » en rue + numéro (format structuré exigé). */
function decouperAdresse_(rue) {
  var m = String(rue || '').trim().match(/^(.*?)[\s,]+(\d+\s?[a-zA-Z]?)$/);
  return m ? { rue: m[1], numero: m[2].replace(/\s/g, '') } : { rue: String(rue || '').trim(), numero: '' };
}

/** Garde uniquement les caractères admis par la norme (latin de base + latin-1). */
function qrTexte_(v) {
  return String(v == null ? '' : v)
    .replace(/[‘’]/g, '\'').replace(/[“”«»]/g, '"').replace(/[–—]/g, '-')
    .replace(/[^ -~ -ÿ]/g, '').trim();
}

function montantQr_() { return CONFIG.PRIX.toFixed(2); }
function montantTexte_() { return CONFIG.DEVISE + ' ' + CONFIG.PRIX + '.–'; }
function montantAffiche_() {
  var p = CONFIG.PRIX.toFixed(2).split('.');
  return p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + '.' + p[1];
}

/**
 * Construit la facture A4 : en-tête, détail, puis le bulletin QR
 * (récépissé + section paiement, 210 × 105 mm) en bas de page.
 * PDF écrit à la main (polices standard Helvetica, QR en vectoriel) :
 * rendu identique partout, aucune dépendance.
 */
function facturePdf_(d) {
  var pdf = new PdfPage_();
  var mm = 72 / 25.4;
  var NAVY = [0.078, 0.129, 0.239], GRIS = [0.29, 0.341, 0.447], NOIR = [0, 0, 0];
  var JAUNE = [0.949, 1, 0.286];
  var k = d.client, s = d.session;

  /* --- En-tête -------------------------------------------------------- */
  pdf.rect(20 * mm, 277 * mm, 4 * mm, 9 * mm, JAUNE);
  pdf.text('Agence Curcuma', 27 * mm, 279.5 * mm, 'F2', 17, NAVY);
  pdf.text('Eve Schaller · Place de la Gare 12 · 2800 Delémont', 27 * mm, 273 * mm, 'F1', 8.5, GRIS);
  pdf.text('eve@agence-curcuma.ch · agence-curcuma.ch', 27 * mm, 268.8 * mm, 'F1', 8.5, GRIS);

  var y = 252 * mm;
  [k.prenom + ' ' + k.nom, k.rue, k.npa + ' ' + k.localite].forEach(function (t, i) {
    pdf.text(t, 120 * mm, y - i * 5 * mm, i === 0 ? 'F2' : 'F1', 10.5, NOIR);
  });

  pdf.text('Facture', 20 * mm, 222 * mm, 'F2', 22, NAVY);
  var infos = [
    ['N° de facture', d.numero],
    ['Date', dateCourte_(d.date)],
    d.chomage ? ['Prise en charge', 'demandée à : ' + d.caisse] : ['À payer d\'ici le', dateCourte_(d.echeance) + ' (confirme votre place)']
  ];
  infos.forEach(function (row, i) {
    pdf.text(row[0], 20 * mm, (212 - i * 5.5) * mm, 'F1', 9.5, GRIS);
    pdf.text(row[1], 55 * mm, (212 - i * 5.5) * mm, 'F2', 9.5, NOIR);
  });

  /* --- Détail --------------------------------------------------------- */
  var droite = 190 * mm;
  y = 186 * mm;
  pdf.text('Désignation', 20 * mm, y, 'F2', 9, GRIS);
  pdf.textRight('Montant (' + CONFIG.DEVISE + ')', droite, y, 'F2', 9, GRIS);
  pdf.line(20 * mm, y - 2.5 * mm, droite, y - 2.5 * mm, 0.6, NAVY);

  y -= 9 * mm;
  pdf.text(CONFIG.TITRE + ' en petit groupe (4 personnes au maximum)', 20 * mm, y, 'F2', 10.5, NOIR);
  pdf.textRight(montantAffiche_(), droite, y, 'F2', 10.5, NOIR);
  [
    s.label.charAt(0).toUpperCase() + s.label.slice(1) + ', ' + horaire_(),
    CONFIG.LIEU_LIGNE1 + ', ' + CONFIG.LIEU_LIGNE2,
    'Repas de midi, boissons et cafés inclus',
    'Attestation de participation remise en fin de journée',
    'Participant·e : ' + k.prenom + ' ' + k.nom
  ].forEach(function (t, i) { pdf.text(t, 20 * mm, y - (5.2 + i * 4.6) * mm, 'F1', 9.5, GRIS); });

  y -= 33 * mm;
  pdf.line(20 * mm, y + 4 * mm, droite, y + 4 * mm, 0.4, GRIS);
  pdf.text('Total', 20 * mm, y - 2 * mm, 'F2', 12, NAVY);
  pdf.textRight(CONFIG.DEVISE + ' ' + montantAffiche_(), droite, y - 2 * mm, 'F2', 12, NAVY);

  y -= 14 * mm;
  [
    CONFIG.MENTION_TVA,
    d.chomage ? 'Facture à transmettre à votre caisse de chômage. Votre place est confirmée dès réception du courrier de l\'ORP.'
      : 'Votre place est réservée jusqu\'au ' + dateCourte_(d.echeance) + ' et confirmée à réception du paiement.',
    'Merci d\'utiliser le bulletin QR ci-dessous : il reprend automatiquement la communication du versement.'
  ].forEach(function (t, i) { pdf.text(t, 20 * mm, y - i * 4.6 * mm, 'F1', 9, GRIS); });

  /* --- Bulletin QR (norme SIX) ---------------------------------------- */
  bulletinQr_(pdf, d, mm);
  return pdf.octets();
}

function bulletinQr_(pdf, d, mm) {
  var c = CONFIG.CREANCIER, k = d.client, N = [0, 0, 0];
  var creancier = [CONFIG.IBAN, c.nom, c.rue + ' ' + c.numero, c.npa + ' ' + c.localite];
  var debiteur = [k.prenom + ' ' + k.nom, k.rue, k.npa + ' ' + k.localite];

  /* Lignes de séparation + mention de découpe */
  pdf.line(0, 105 * mm, 210 * mm, 105 * mm, 0.5, N, [2, 2]);
  pdf.line(62 * mm, 0, 62 * mm, 105 * mm, 0.5, N, [2, 2]);
  pdf.textCenter('À détacher avant le versement', 105 * mm, 106.5 * mm, 'F1', 7, N);

  /* --- Récépissé (titre 11 pt, rubriques 6 pt, valeurs 8 pt) --- */
  var x = 5 * mm, y = 95 * mm;
  pdf.text('Récépissé', x, y, 'F2', 11, N);
  y = 88 * mm;
  y = bloc_(pdf, 'Compte / Payable à', creancier, x, y, 6, 8, 9, 52 * mm);
  y = bloc_(pdf, 'Payable par', debiteur, x, y - 9, 6, 8, 9, 52 * mm);
  pdf.text('Monnaie', x, 37 * mm, 'F2', 6, N);
  pdf.text('Montant', x + 13 * mm, 37 * mm, 'F2', 6, N);
  pdf.text(CONFIG.DEVISE, x, 33 * mm, 'F1', 8, N);
  pdf.text(montantAffiche_(), x + 13 * mm, 33 * mm, 'F1', 8, N);
  pdf.textRight('Point de dépôt', 57 * mm, 18 * mm, 'F2', 6, N);

  /* --- Section paiement (titre 11 pt, rubriques 8 pt, valeurs 10 pt) --- */
  x = 67 * mm;
  pdf.text('Section paiement', x, 95 * mm, 'F2', 11, N);
  dessinerQr_(pdf, payloadQr_(d), x, 42 * mm, 46 * mm);
  pdf.text('Monnaie', x, 37 * mm, 'F2', 8, N);
  pdf.text('Montant', x + 15 * mm, 37 * mm, 'F2', 8, N);
  pdf.text(CONFIG.DEVISE, x, 32.5 * mm, 'F1', 10, N);
  pdf.text(montantAffiche_(), x + 15 * mm, 32.5 * mm, 'F1', 10, N);

  x = 118 * mm; y = 97 * mm;
  y = bloc_(pdf, 'Compte / Payable à', creancier, x, y, 8, 10, 11, 87 * mm);
  y = bloc_(pdf, 'Informations supplémentaires', [messageQr_(d)], x, y - 11, 8, 10, 11, 87 * mm);
  bloc_(pdf, 'Payable par (nom/adresse)', debiteur, x, y - 11, 8, 10, 11, 87 * mm);
}

/** Rubrique + lignes (avec retour à la ligne). Retourne le y suivant. */
function bloc_(pdf, titre, lignes, x, y, tTitre, tVal, interligne, largeur) {
  pdf.text(titre, x, y, 'F2', tTitre, [0, 0, 0]);
  y -= interligne;
  lignes.forEach(function (l) {
    pdf.couper(l, 'F1', tVal, largeur).forEach(function (morceau) {
      pdf.text(morceau, x, y, 'F1', tVal, [0, 0, 0]);
      y -= interligne;
    });
  });
  return y;
}

/** QR en modules vectoriels + croix suisse 7 × 7 mm au centre. */
function dessinerQr_(pdf, texte, x, y, taille) {
  qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
  var q = qrcode(0, 'M');
  q.addData(texte, 'Byte');
  q.make();
  var n = q.getModuleCount(), m = taille / n;
  for (var r = 0; r < n; r++) {
    var c = 0;
    while (c < n) {
      if (!q.isDark(r, c)) { c++; continue; }
      var debut = c;
      while (c < n && q.isDark(r, c)) c++;
      pdf.rect(x + debut * m, y + taille - (r + 1) * m, (c - debut) * m, m, [0, 0, 0]);
    }
  }
  var mm = 72 / 25.4, cx = x + taille / 2, cy = y + taille / 2;
  var cote = 7 * mm, noir = 6 * mm, bras = 3.9 * mm, ep = 1.17 * mm;
  pdf.rect(cx - cote / 2, cy - cote / 2, cote, cote, [1, 1, 1]);
  pdf.rect(cx - noir / 2, cy - noir / 2, noir, noir, [0, 0, 0]);
  pdf.rect(cx - ep / 2, cy - bras / 2, ep, bras, [1, 1, 1]);
  pdf.rect(cx - bras / 2, cy - ep / 2, bras, ep, [1, 1, 1]);
}

/** Page PDF A4 minimale : texte Helvetica (WinAnsi), traits, rectangles. */
function PdfPage_() { this.ops = []; }
PdfPage_.prototype.couleur_ = function (c, stroke) {
  return c.map(function (v) { return (+v).toFixed(3); }).join(' ') + (stroke ? ' RG' : ' rg');
};
PdfPage_.prototype.largeur = function (t, font, size) {
  var w = 0, b = winAnsi_(t), table = LARGEURS_[font];
  for (var i = 0; i < b.length; i++) w += table[b[i]] || 556;
  return w * size / 1000;
};
PdfPage_.prototype.text = function (t, x, y, font, size, col) {
  var b = winAnsi_(t), s = '';
  for (var i = 0; i < b.length; i++) {
    var ch = b[i];
    if (ch === 40 || ch === 41 || ch === 92) s += '\\' + String.fromCharCode(ch);
    else s += String.fromCharCode(ch);
  }
  this.ops.push('BT ' + this.couleur_(col || [0, 0, 0]) + ' /' + font + ' ' + size + ' Tf ' +
    x.toFixed(2) + ' ' + y.toFixed(2) + ' Td (' + s + ') Tj ET');
};
PdfPage_.prototype.textRight = function (t, x, y, f, s, c) { this.text(t, x - this.largeur(t, f, s), y, f, s, c); };
PdfPage_.prototype.textCenter = function (t, x, y, f, s, c) { this.text(t, x - this.largeur(t, f, s) / 2, y, f, s, c); };
PdfPage_.prototype.line = function (x1, y1, x2, y2, w, col, dash) {
  this.ops.push(this.couleur_(col, true) + ' ' + w + ' w ' + (dash ? '[' + dash.join(' ') + '] 0 d ' : '[] 0 d ') +
    x1.toFixed(2) + ' ' + y1.toFixed(2) + ' m ' + x2.toFixed(2) + ' ' + y2.toFixed(2) + ' l S');
};
PdfPage_.prototype.rect = function (x, y, w, h, col) {
  this.ops.push(this.couleur_(col) + ' ' + x.toFixed(3) + ' ' + y.toFixed(3) + ' ' + w.toFixed(3) + ' ' + h.toFixed(3) + ' re f');
};
PdfPage_.prototype.couper = function (t, font, size, max) {
  var mots = String(t).split(' '), lignes = [], cur = '';
  for (var i = 0; i < mots.length; i++) {
    var essai = cur ? cur + ' ' + mots[i] : mots[i];
    if (this.largeur(essai, font, size) > max && cur) { lignes.push(cur); cur = mots[i]; } else cur = essai;
  }
  if (cur) lignes.push(cur);
  return lignes;
};
PdfPage_.prototype.octets = function () {
  var contenu = this.ops.join('\n');
  var objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    '<< /Length ' + contenu.length + ' >>\nstream\n' + contenu + '\nendstream'
  ];
  var out = '%PDF-1.4\n%âãÏÓ\n', offsets = [];
  objs.forEach(function (o, i) { offsets.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
  var xref = out.length;
  out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
  offsets.forEach(function (o) { out += ('0000000000' + o).slice(-10) + ' 00000 n \n'; });
  out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  var b = [];
  for (var i = 0; i < out.length; i++) b.push(out.charCodeAt(i) & 255);
  return b;
};

/** Texte Unicode → octets WinAnsi (cp1252). */
function winAnsi_(t) {
  var sp = { 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
    0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91,
    0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98,
    0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F, 0x202F: 0xA0 };
  var out = [], s = String(t == null ? '' : t);
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c >= 32 && c < 127) out.push(c);
    else if (c >= 0xA0 && c <= 0xFF) out.push(c);
    else if (sp[c]) out.push(sp[c]);
    else out.push(63);
  }
  return out;
}


/* ==========================================================================
   7. FEUILLE
   ========================================================================== */

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sh) { initialiserFeuille(); sh = ss.getSheetByName(CONFIG.SHEET_NAME); }
  return sh;
}

function lireTout_(sh) {
  var n = sh.getLastRow() - 1;
  if (n < 1) return [];
  var v = sh.getRange(2, 1, n, LAST_COL).getValues(), out = [];
  for (var i = 0; i < n; i++) if (v[i][COL.EMAIL - 1]) out.push(objet_(v[i], i + 2));
  return out;
}

function lireLigne_(sh, r) { return objet_(sh.getRange(r, 1, 1, LAST_COL).getValues()[0], r); }

function objet_(v, r) {
  var g = function (c) { return v[c - 1]; };
  return {
    ligne: r, date: g(COL.DATE), session: String(g(COL.SESSION) || '').trim(),
    prenom: String(g(COL.PRENOM) || ''), nom: String(g(COL.NOM) || ''),
    email: String(g(COL.EMAIL) || '').trim().toLowerCase(),
    rue: String(g(COL.RUE) || ''), npa: String(g(COL.NPA) || ''), localite: String(g(COL.LOCALITE) || ''),
    statut: String(g(COL.STATUT) || '').trim().toUpperCase(),
    reserveeJusqu: g(COL.RESERVEE_JUSQU), paiementRecu: g(COL.PAIEMENT_RECU) === true,
    facture: String(g(COL.FACTURE) || ''), confirmEnvoyee: g(COL.CONFIRM_ENVOYEE) === true,
    entreeAttente: g(COL.ENTREE_ATTENTE), code: String(g(COL.CODE) || ''),
    chomage: String(g(COL.CHOMAGE) || '').toLowerCase() === 'oui',
    caisse: String(g(COL.CAISSE) || ''), validation: String(g(COL.VALIDATION_ORP) || '')
  };
}

function compter_(lignes, sessionId, statuts) {
  return lignes.filter(function (l) { return l.session === sessionId && statuts.indexOf(l.statut) !== -1; }).length;
}

function ecrireInscription_(sh, p, s, statut) {
  var maintenant = new Date();
  sh.appendRow([
    maintenant, s.id, s.label, p.prenom, p.nom, p.email, p.rue, "'" + p.npa, p.localite, p.attentes,
    p.newsletter, p.consentement, p.chomage, p.caisse, p.validation, statut, '', false, '', '', false,
    statut === ST.ATTENTE ? maintenant : '', '', horodate_(maintenant) + ' — inscription : ' + statut
  ]);
  var r = sh.getLastRow();
  sh.getRange(r, COL.PAIEMENT_RECU).insertCheckboxes();
  sh.getRange(r, COL.CONFIRM_ENVOYEE).insertCheckboxes();
  SpreadsheetApp.flush();
  return r;
}

function tracer_(sh, r, texte) {
  var c = sh.getRange(r, COL.HISTORIQUE), a = String(c.getValue() || '');
  c.setValue((a ? a + '\n' : '') + horodate_(new Date()) + ' — ' + texte);
}

function prochainNumeroFacture_() {
  var props = PropertiesService.getScriptProperties();
  var an = Utilities.formatDate(new Date(), CONFIG.FUSEAU, 'yyyy');
  var cle = 'facture_' + an, n = parseInt(props.getProperty(cle) || '0', 10) + 1;
  props.setProperty(cle, String(n));
  return CONFIG.PREFIXE_FACTURE + '-' + an + '-' + ('00' + n).slice(-3);
}

function dossierFactures_() {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('dossier_factures');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var it = DriveApp.getFoldersByName(CONFIG.DOSSIER_FACTURES);
  var dossier = it.hasNext() ? it.next() : DriveApp.createFolder(CONFIG.DOSSIER_FACTURES);
  props.setProperty('dossier_factures', dossier.getId());
  return dossier;
}


/* ==========================================================================
   8. DATES ET OUTILS
   ========================================================================== */

function trouverSession_(id) {
  for (var i = 0; i < CONFIG.SESSIONS.length; i++) if (CONFIG.SESSIONS[i].id === id) return CONFIG.SESSIONS[i];
  return null;
}
function dateHeure_(date, heure) { return Utilities.parseDate(date + ' ' + heure, CONFIG.FUSEAU, 'yyyy-MM-dd HH:mm'); }
function debutSession_(s) { return dateHeure_(s.date, CONFIG.HEURE_DEBUT); }
function finSession_(s) { return dateHeure_(s.date, CONFIG.HEURE_FIN); }
function clotureSession_(s) {
  var veille = new Date(debutSession_(s).getTime() - 86400000);
  return dateHeure_(Utilities.formatDate(veille, CONFIG.FUSEAU, 'yyyy-MM-dd'), CONFIG.CLOTURE_VEILLE_HEURE);
}
/** 72 h, sans dépasser la veille du cours à 18h00. */
function echeanceReservation_(s, depuis) {
  var e = new Date(depuis.getTime() + CONFIG.RESERVATION_HEURES * 3600000);
  var veille = new Date(debutSession_(s).getTime() - 86400000);
  var limite = dateHeure_(Utilities.formatDate(veille, CONFIG.FUSEAU, 'yyyy-MM-dd'), '18:00');
  return e < limite ? e : limite;
}

var JOURS_ = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
var MOIS_ = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
function dateLongue_(d) {
  var j = parseInt(Utilities.formatDate(d, CONFIG.FUSEAU, 'u'), 10) % 7;
  return JOURS_[j] + ' ' + parseInt(Utilities.formatDate(d, CONFIG.FUSEAU, 'd'), 10) + ' ' +
    MOIS_[parseInt(Utilities.formatDate(d, CONFIG.FUSEAU, 'M'), 10) - 1] + ' à ' + Utilities.formatDate(d, CONFIG.FUSEAU, "HH'h'mm");
}
/** « 8h30–17h00 » */
function horaire_() { var f = function (h) { return h.replace(/^0/, '').replace(':', 'h'); }; return f(CONFIG.HEURE_DEBUT) + '–' + f(CONFIG.HEURE_FIN); }
function dateCourte_(d) { return Utilities.formatDate(d, CONFIG.FUSEAU, 'dd.MM.yyyy'); }
function horodate_(d) { return d instanceof Date ? Utilities.formatDate(d, CONFIG.FUSEAU, 'dd.MM.yyyy HH:mm') : String(d || ''); }

function lireRequete_(e) {
  if (e && e.postData && e.postData.contents) {
    var t = String(e.postData.type || '');
    if (t.indexOf('json') === -1 && t.indexOf('plain') === -1) return e.parameter || {};
    try { return JSON.parse(e.postData.contents); } catch (err) { return e.parameter || {}; }
  }
  return (e && e.parameter) || {};
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function nettoyer_(v, max) {
  var s = String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (/^[=+\-@]/.test(s)) s = s.replace(/^[=+\-@]+/, '').trim();
  return max && s.length > max ? s.substring(0, max) : s;
}
function emailValide_(m) { return /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(String(m || '')) && String(m).length <= 120; }
function estCoche_(v) { var s = String(v == null ? '' : v).trim().toLowerCase(); return s === 'oui' || s === 'on' || s === 'true' || s === '1'; }
function colonneEnLettre_(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; }


/* ==========================================================================
   9. INSTALLATION ET MENU
   ========================================================================== */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Atelier IA')
    .addItem('📊 Voir les places par date', 'actionEtat')
    .addItem('📧 Renvoyer la facture (ligne sélectionnée)', 'actionRenvoyerFacture')
    .addItem('🔄 Vérifier maintenant (échéances, liste d\'attente)', 'verifierEcheances')
    .addItem('🗓️ Mettre à jour l\'agenda', 'actionMajAgenda')
    .addSeparator()
    .addItem('🛠️ Initialiser / réparer la feuille', 'initialiserFeuille')
    .addToUi();
}

function actionEtat() {
  var lignes = lireTout_(getSheet_());
  alerte_(CONFIG.SESSIONS.map(function (s) {
    return s.label + '\n  confirmées : ' + compter_(lignes, s.id, STATUTS_CONFIRMES) + ' / ' + CONFIG.PLACES_MAX +
      '\n  réservées (paiement attendu) : ' + compter_(lignes, s.id, [ST.RESERVEE]) +
      '\n  liste d\'attente : ' + compter_(lignes, s.id, [ST.ATTENTE]);
  }).join('\n\n'));
}

function actionRenvoyerFacture() {
  var sh = SpreadsheetApp.getActiveSheet(), r = SpreadsheetApp.getActiveRange().getRow();
  if (sh.getName() !== CONFIG.SHEET_NAME || r < 2) return alerte_('Sélectionne d\'abord la ligne de la personne.');
  var l = lireLigne_(sh, r), s = trouverSession_(l.session);
  if (!l.facture || !(l.reserveeJusqu instanceof Date)) return alerte_('Cette personne n\'a pas encore de facture (liste d\'attente ?).');
  emailFacture_(l, s, l.reserveeJusqu, factureBlob_(l, s, l.facture, new Date(), l.reserveeJusqu), false);
  tracer_(sh, r, 'facture renvoyée à la main');
  alerte_('Facture ' + l.facture + ' renvoyée à ' + l.email + '.');
}

function actionMajAgenda() { CONFIG.SESSIONS.forEach(function (s) { majAgenda_(s.id); }); alerte_('Agenda mis à jour.'); }

function initialiserFeuille() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(CONFIG.SHEET_NAME) || ss.insertSheet(CONFIG.SHEET_NAME);
  sh.getRange(1, 1, 1, LAST_COL).setValues([HEADERS]).setFontWeight('bold')
    .setBackground('#14213D').setFontColor('#F7F1E3').setVerticalAlignment('middle').setWrap(true);
  sh.setRowHeight(1, 44);
  sh.setFrozenRows(1);
  sh.setFrozenColumns(5);
  var larg = [130, 120, 170, 110, 110, 210, 170, 60, 120, 280, 85, 90, 90, 180, 130, 160, 130, 90, 130, 120, 100, 140, 220, 320, 120];
  larg.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  var n = Math.max(sh.getMaxRows() - 1, 300);
  sh.getRange(2, COL.STATUT, n, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList([ST.RESERVEE, ST.PAYEE, ST.PEC, ST.ATTENTE, ST.PREINSCR, ST.DESACTIVEE, ST.ANNULEE], true).setAllowInvalid(false).build());
  sh.getRange(2, COL.SESSION, n, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(CONFIG.SESSIONS.map(function (s) { return s.id; }), true).setAllowInvalid(false).build());
  /* Pas de cases à cocher pré-remplies : une case vide compte comme une
     ligne occupée et les inscriptions s'écriraient tout en bas. Chaque
     ligne reçoit ses cases au moment de l'inscription. */
  [COL.DATE, COL.RESERVEE_JUSQU, COL.DATE_PAIEMENT, COL.ENTREE_ATTENTE].forEach(function (c) {
    sh.getRange(2, c, n, 1).setNumberFormat('dd.MM.yyyy HH:mm');
  });
  var plage = sh.getRange(2, 1, n, LAST_COL), L = colonneEnLettre_(COL.STATUT);
  var regle = function (st, fond, txt) {
    return SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$' + L + '2="' + st + '"')
      .setBackground(fond).setFontColor(txt).setRanges([plage]).build();
  };
  sh.setConditionalFormatRules([
    regle(ST.PAYEE, '#D6F5DC', '#0B5323'), regle(ST.PEC, '#D6F5DC', '#0B5323'),
    regle(ST.RESERVEE, '#FDE6C9', '#7A3E00'), regle(ST.ATTENTE, '#E8EAED', '#3C4043'), regle(ST.PREINSCR, '#DCE6F7', '#243A63'), regle(ST.DESACTIVEE, '#F3E8E0', '#8A5A3C'),
    regle(ST.ANNULEE, '#FAD2CF', '#7A0C0C')
  ]);
}

function installer() {
  initialiserFeuille();
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('onEditInstallable').forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
  ScriptApp.newTrigger('verifierEcheances').timeBased().everyHours(1).create();
  CONFIG.SESSIONS.forEach(function (s) { majAgenda_(s.id); });
  dossierFactures_();
  alerte_('Installation terminée : feuille, déclencheurs, événements dans l\'agenda et dossier « ' + CONFIG.DOSSIER_FACTURES + ' » dans Drive.');
}

function alerte_(m) { try { SpreadsheetApp.getUi().alert(m); } catch (e) { Logger.log(m); } }

/** Test : écrit une vraie inscription à ton nom et t'envoie la facture. */
function testInscription() {
  var e = { postData: { type: 'text/plain', contents: JSON.stringify({
    session: CONFIG.SESSIONS[0].id, prenom: 'Test', nom: 'Curcuma', email: CONFIG.ADMIN_EMAIL,
    rue: 'Place de la Gare 12', npa: '2800', localite: 'Delémont', attentes: 'Test du système',
    consentement: 'oui', newsletter: 'non', site_web: '' }) } };
  Logger.log(doPost(e).getContent());
}

/** Test : t'envoie seulement une facture d'exemple, sans rien écrire. */
function testFacture() {
  var s = CONFIG.SESSIONS[0];
  var l = { prenom: 'Camille', nom: 'Rossier', rue: 'Rue du Moulin 12a', npa: '2800', localite: 'Delémont', email: CONFIG.ADMIN_EMAIL };
  var ech = echeanceReservation_(s, new Date());
  emailFacture_(l, s, ech, factureBlob_(l, s, 'JIA-TEST-001', new Date(), ech), false);
}

/* ==========================================================================
   10. BIBLIOTHÈQUES EMBARQUÉES (ne pas modifier)
   ========================================================================== */

/* Largeurs Helvetica (WinAnsiEncoding, codes 0-255, en 1/1000 em). */
var LARGEURS_ = {
  F1: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,350,556,350,222,556,333,1000,556,556,333,1000,667,333,1000,350,611,350,350,222,222,333,333,350,556,1000,333,1000,500,333,944,350,500,667,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500],
  F2: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,350,556,350,278,556,500,1000,556,556,333,1000,667,333,1000,350,611,350,350,278,278,500,500,350,556,1000,333,1000,556,333,944,350,500,667,278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556],
};

/* qrcode-generator 1.4.4 — Kazuhiko Arase — licence MIT — https://github.com/kazuhikoarase/qrcode-generator */
//---------------------------------------------------------------------
//
// QR Code Generator for JavaScript
//
// Copyright (c) 2009 Kazuhiko Arase
//
// URL: http://www.d-project.com/
//
// Licensed under the MIT license:
//  http://www.opensource.org/licenses/mit-license.php
//
// The word 'QR Code' is registered trademark of
// DENSO WAVE INCORPORATED
//  http://www.denso-wave.com/qrcode/faqpatent-e.html
//
//---------------------------------------------------------------------

var qrcode = function() {

  //---------------------------------------------------------------------
  // qrcode
  //---------------------------------------------------------------------

  /**
   * qrcode
   * @param typeNumber 1 to 40
   * @param errorCorrectionLevel 'L','M','Q','H'
   */
  var qrcode = function(typeNumber, errorCorrectionLevel) {

    var PAD0 = 0xEC;
    var PAD1 = 0x11;

    var _typeNumber = typeNumber;
    var _errorCorrectionLevel = QRErrorCorrectionLevel[errorCorrectionLevel];
    var _modules = null;
    var _moduleCount = 0;
    var _dataCache = null;
    var _dataList = [];

    var _this = {};

    var makeImpl = function(test, maskPattern) {

      _moduleCount = _typeNumber * 4 + 17;
      _modules = function(moduleCount) {
        var modules = new Array(moduleCount);
        for (var row = 0; row < moduleCount; row += 1) {
          modules[row] = new Array(moduleCount);
          for (var col = 0; col < moduleCount; col += 1) {
            modules[row][col] = null;
          }
        }
        return modules;
      }(_moduleCount);

      setupPositionProbePattern(0, 0);
      setupPositionProbePattern(_moduleCount - 7, 0);
      setupPositionProbePattern(0, _moduleCount - 7);
      setupPositionAdjustPattern();
      setupTimingPattern();
      setupTypeInfo(test, maskPattern);

      if (_typeNumber >= 7) {
        setupTypeNumber(test);
      }

      if (_dataCache == null) {
        _dataCache = createData(_typeNumber, _errorCorrectionLevel, _dataList);
      }

      mapData(_dataCache, maskPattern);
    };

    var setupPositionProbePattern = function(row, col) {

      for (var r = -1; r <= 7; r += 1) {

        if (row + r <= -1 || _moduleCount <= row + r) continue;

        for (var c = -1; c <= 7; c += 1) {

          if (col + c <= -1 || _moduleCount <= col + c) continue;

          if ( (0 <= r && r <= 6 && (c == 0 || c == 6) )
              || (0 <= c && c <= 6 && (r == 0 || r == 6) )
              || (2 <= r && r <= 4 && 2 <= c && c <= 4) ) {
            _modules[row + r][col + c] = true;
          } else {
            _modules[row + r][col + c] = false;
          }
        }
      }
    };

    var getBestMaskPattern = function() {

      var minLostPoint = 0;
      var pattern = 0;

      for (var i = 0; i < 8; i += 1) {

        makeImpl(true, i);

        var lostPoint = QRUtil.getLostPoint(_this);

        if (i == 0 || minLostPoint > lostPoint) {
          minLostPoint = lostPoint;
          pattern = i;
        }
      }

      return pattern;
    };

    var setupTimingPattern = function() {

      for (var r = 8; r < _moduleCount - 8; r += 1) {
        if (_modules[r][6] != null) {
          continue;
        }
        _modules[r][6] = (r % 2 == 0);
      }

      for (var c = 8; c < _moduleCount - 8; c += 1) {
        if (_modules[6][c] != null) {
          continue;
        }
        _modules[6][c] = (c % 2 == 0);
      }
    };

    var setupPositionAdjustPattern = function() {

      var pos = QRUtil.getPatternPosition(_typeNumber);

      for (var i = 0; i < pos.length; i += 1) {

        for (var j = 0; j < pos.length; j += 1) {

          var row = pos[i];
          var col = pos[j];

          if (_modules[row][col] != null) {
            continue;
          }

          for (var r = -2; r <= 2; r += 1) {

            for (var c = -2; c <= 2; c += 1) {

              if (r == -2 || r == 2 || c == -2 || c == 2
                  || (r == 0 && c == 0) ) {
                _modules[row + r][col + c] = true;
              } else {
                _modules[row + r][col + c] = false;
              }
            }
          }
        }
      }
    };

    var setupTypeNumber = function(test) {

      var bits = QRUtil.getBCHTypeNumber(_typeNumber);

      for (var i = 0; i < 18; i += 1) {
        var mod = (!test && ( (bits >> i) & 1) == 1);
        _modules[Math.floor(i / 3)][i % 3 + _moduleCount - 8 - 3] = mod;
      }

      for (var i = 0; i < 18; i += 1) {
        var mod = (!test && ( (bits >> i) & 1) == 1);
        _modules[i % 3 + _moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
      }
    };

    var setupTypeInfo = function(test, maskPattern) {

      var data = (_errorCorrectionLevel << 3) | maskPattern;
      var bits = QRUtil.getBCHTypeInfo(data);

      // vertical
      for (var i = 0; i < 15; i += 1) {

        var mod = (!test && ( (bits >> i) & 1) == 1);

        if (i < 6) {
          _modules[i][8] = mod;
        } else if (i < 8) {
          _modules[i + 1][8] = mod;
        } else {
          _modules[_moduleCount - 15 + i][8] = mod;
        }
      }

      // horizontal
      for (var i = 0; i < 15; i += 1) {

        var mod = (!test && ( (bits >> i) & 1) == 1);

        if (i < 8) {
          _modules[8][_moduleCount - i - 1] = mod;
        } else if (i < 9) {
          _modules[8][15 - i - 1 + 1] = mod;
        } else {
          _modules[8][15 - i - 1] = mod;
        }
      }

      // fixed module
      _modules[_moduleCount - 8][8] = (!test);
    };

    var mapData = function(data, maskPattern) {

      var inc = -1;
      var row = _moduleCount - 1;
      var bitIndex = 7;
      var byteIndex = 0;
      var maskFunc = QRUtil.getMaskFunction(maskPattern);

      for (var col = _moduleCount - 1; col > 0; col -= 2) {

        if (col == 6) col -= 1;

        while (true) {

          for (var c = 0; c < 2; c += 1) {

            if (_modules[row][col - c] == null) {

              var dark = false;

              if (byteIndex < data.length) {
                dark = ( ( (data[byteIndex] >>> bitIndex) & 1) == 1);
              }

              var mask = maskFunc(row, col - c);

              if (mask) {
                dark = !dark;
              }

              _modules[row][col - c] = dark;
              bitIndex -= 1;

              if (bitIndex == -1) {
                byteIndex += 1;
                bitIndex = 7;
              }
            }
          }

          row += inc;

          if (row < 0 || _moduleCount <= row) {
            row -= inc;
            inc = -inc;
            break;
          }
        }
      }
    };

    var createBytes = function(buffer, rsBlocks) {

      var offset = 0;

      var maxDcCount = 0;
      var maxEcCount = 0;

      var dcdata = new Array(rsBlocks.length);
      var ecdata = new Array(rsBlocks.length);

      for (var r = 0; r < rsBlocks.length; r += 1) {

        var dcCount = rsBlocks[r].dataCount;
        var ecCount = rsBlocks[r].totalCount - dcCount;

        maxDcCount = Math.max(maxDcCount, dcCount);
        maxEcCount = Math.max(maxEcCount, ecCount);

        dcdata[r] = new Array(dcCount);

        for (var i = 0; i < dcdata[r].length; i += 1) {
          dcdata[r][i] = 0xff & buffer.getBuffer()[i + offset];
        }
        offset += dcCount;

        var rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
        var rawPoly = qrPolynomial(dcdata[r], rsPoly.getLength() - 1);

        var modPoly = rawPoly.mod(rsPoly);
        ecdata[r] = new Array(rsPoly.getLength() - 1);
        for (var i = 0; i < ecdata[r].length; i += 1) {
          var modIndex = i + modPoly.getLength() - ecdata[r].length;
          ecdata[r][i] = (modIndex >= 0)? modPoly.getAt(modIndex) : 0;
        }
      }

      var totalCodeCount = 0;
      for (var i = 0; i < rsBlocks.length; i += 1) {
        totalCodeCount += rsBlocks[i].totalCount;
      }

      var data = new Array(totalCodeCount);
      var index = 0;

      for (var i = 0; i < maxDcCount; i += 1) {
        for (var r = 0; r < rsBlocks.length; r += 1) {
          if (i < dcdata[r].length) {
            data[index] = dcdata[r][i];
            index += 1;
          }
        }
      }

      for (var i = 0; i < maxEcCount; i += 1) {
        for (var r = 0; r < rsBlocks.length; r += 1) {
          if (i < ecdata[r].length) {
            data[index] = ecdata[r][i];
            index += 1;
          }
        }
      }

      return data;
    };

    var createData = function(typeNumber, errorCorrectionLevel, dataList) {

      var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectionLevel);

      var buffer = qrBitBuffer();

      for (var i = 0; i < dataList.length; i += 1) {
        var data = dataList[i];
        buffer.put(data.getMode(), 4);
        buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber) );
        data.write(buffer);
      }

      // calc num max data.
      var totalDataCount = 0;
      for (var i = 0; i < rsBlocks.length; i += 1) {
        totalDataCount += rsBlocks[i].dataCount;
      }

      if (buffer.getLengthInBits() > totalDataCount * 8) {
        throw 'code length overflow. ('
          + buffer.getLengthInBits()
          + '>'
          + totalDataCount * 8
          + ')';
      }

      // end code
      if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) {
        buffer.put(0, 4);
      }

      // padding
      while (buffer.getLengthInBits() % 8 != 0) {
        buffer.putBit(false);
      }

      // padding
      while (true) {

        if (buffer.getLengthInBits() >= totalDataCount * 8) {
          break;
        }
        buffer.put(PAD0, 8);

        if (buffer.getLengthInBits() >= totalDataCount * 8) {
          break;
        }
        buffer.put(PAD1, 8);
      }

      return createBytes(buffer, rsBlocks);
    };

    _this.addData = function(data, mode) {

      mode = mode || 'Byte';

      var newData = null;

      switch(mode) {
      case 'Numeric' :
        newData = qrNumber(data);
        break;
      case 'Alphanumeric' :
        newData = qrAlphaNum(data);
        break;
      case 'Byte' :
        newData = qr8BitByte(data);
        break;
      case 'Kanji' :
        newData = qrKanji(data);
        break;
      default :
        throw 'mode:' + mode;
      }

      _dataList.push(newData);
      _dataCache = null;
    };

    _this.isDark = function(row, col) {
      if (row < 0 || _moduleCount <= row || col < 0 || _moduleCount <= col) {
        throw row + ',' + col;
      }
      return _modules[row][col];
    };

    _this.getModuleCount = function() {
      return _moduleCount;
    };

    _this.make = function() {
      if (_typeNumber < 1) {
        var typeNumber = 1;

        for (; typeNumber < 40; typeNumber++) {
          var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, _errorCorrectionLevel);
          var buffer = qrBitBuffer();

          for (var i = 0; i < _dataList.length; i++) {
            var data = _dataList[i];
            buffer.put(data.getMode(), 4);
            buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber) );
            data.write(buffer);
          }

          var totalDataCount = 0;
          for (var i = 0; i < rsBlocks.length; i++) {
            totalDataCount += rsBlocks[i].dataCount;
          }

          if (buffer.getLengthInBits() <= totalDataCount * 8) {
            break;
          }
        }

        _typeNumber = typeNumber;
      }

      makeImpl(false, getBestMaskPattern() );
    };

    _this.createTableTag = function(cellSize, margin) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var qrHtml = '';

      qrHtml += '<table style="';
      qrHtml += ' border-width: 0px; border-style: none;';
      qrHtml += ' border-collapse: collapse;';
      qrHtml += ' padding: 0px; margin: ' + margin + 'px;';
      qrHtml += '">';
      qrHtml += '<tbody>';

      for (var r = 0; r < _this.getModuleCount(); r += 1) {

        qrHtml += '<tr>';

        for (var c = 0; c < _this.getModuleCount(); c += 1) {
          qrHtml += '<td style="';
          qrHtml += ' border-width: 0px; border-style: none;';
          qrHtml += ' border-collapse: collapse;';
          qrHtml += ' padding: 0px; margin: 0px;';
          qrHtml += ' width: ' + cellSize + 'px;';
          qrHtml += ' height: ' + cellSize + 'px;';
          qrHtml += ' background-color: ';
          qrHtml += _this.isDark(r, c)? '#000000' : '#ffffff';
          qrHtml += ';';
          qrHtml += '"/>';
        }

        qrHtml += '</tr>';
      }

      qrHtml += '</tbody>';
      qrHtml += '</table>';

      return qrHtml;
    };

    _this.createSvgTag = function(cellSize, margin, alt, title) {

      var opts = {};
      if (typeof arguments[0] == 'object') {
        // Called by options.
        opts = arguments[0];
        // overwrite cellSize and margin.
        cellSize = opts.cellSize;
        margin = opts.margin;
        alt = opts.alt;
        title = opts.title;
      }

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      // Compose alt property surrogate
      alt = (typeof alt === 'string') ? {text: alt} : alt || {};
      alt.text = alt.text || null;
      alt.id = (alt.text) ? alt.id || 'qrcode-description' : null;

      // Compose title property surrogate
      title = (typeof title === 'string') ? {text: title} : title || {};
      title.text = title.text || null;
      title.id = (title.text) ? title.id || 'qrcode-title' : null;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var c, mc, r, mr, qrSvg='', rect;

      rect = 'l' + cellSize + ',0 0,' + cellSize +
        ' -' + cellSize + ',0 0,-' + cellSize + 'z ';

      qrSvg += '<svg version="1.1" xmlns="http://www.w3.org/2000/svg"';
      qrSvg += !opts.scalable ? ' width="' + size + 'px" height="' + size + 'px"' : '';
      qrSvg += ' viewBox="0 0 ' + size + ' ' + size + '" ';
      qrSvg += ' preserveAspectRatio="xMinYMin meet"';
      qrSvg += (title.text || alt.text) ? ' role="img" aria-labelledby="' +
          escapeXml([title.id, alt.id].join(' ').trim() ) + '"' : '';
      qrSvg += '>';
      qrSvg += (title.text) ? '<title id="' + escapeXml(title.id) + '">' +
          escapeXml(title.text) + '</title>' : '';
      qrSvg += (alt.text) ? '<description id="' + escapeXml(alt.id) + '">' +
          escapeXml(alt.text) + '</description>' : '';
      qrSvg += '<rect width="100%" height="100%" fill="white" cx="0" cy="0"/>';
      qrSvg += '<path d="';

      for (r = 0; r < _this.getModuleCount(); r += 1) {
        mr = r * cellSize + margin;
        for (c = 0; c < _this.getModuleCount(); c += 1) {
          if (_this.isDark(r, c) ) {
            mc = c*cellSize+margin;
            qrSvg += 'M' + mc + ',' + mr + rect;
          }
        }
      }

      qrSvg += '" stroke="transparent" fill="black"/>';
      qrSvg += '</svg>';

      return qrSvg;
    };

    _this.createDataURL = function(cellSize, margin) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      return createDataURL(size, size, function(x, y) {
        if (min <= x && x < max && min <= y && y < max) {
          var c = Math.floor( (x - min) / cellSize);
          var r = Math.floor( (y - min) / cellSize);
          return _this.isDark(r, c)? 0 : 1;
        } else {
          return 1;
        }
      } );
    };

    _this.createImgTag = function(cellSize, margin, alt) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;

      var img = '';
      img += '<img';
      img += '\u0020src="';
      img += _this.createDataURL(cellSize, margin);
      img += '"';
      img += '\u0020width="';
      img += size;
      img += '"';
      img += '\u0020height="';
      img += size;
      img += '"';
      if (alt) {
        img += '\u0020alt="';
        img += escapeXml(alt);
        img += '"';
      }
      img += '/>';

      return img;
    };

    var escapeXml = function(s) {
      var escaped = '';
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charAt(i);
        switch(c) {
        case '<': escaped += '&lt;'; break;
        case '>': escaped += '&gt;'; break;
        case '&': escaped += '&amp;'; break;
        case '"': escaped += '&quot;'; break;
        default : escaped += c; break;
        }
      }
      return escaped;
    };

    var _createHalfASCII = function(margin) {
      var cellSize = 1;
      margin = (typeof margin == 'undefined')? cellSize * 2 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      var y, x, r1, r2, p;

      var blocks = {
        '██': '█',
        '█ ': '▀',
        ' █': '▄',
        '  ': ' '
      };

      var blocksLastLineNoMargin = {
        '██': '▀',
        '█ ': '▀',
        ' █': ' ',
        '  ': ' '
      };

      var ascii = '';
      for (y = 0; y < size; y += 2) {
        r1 = Math.floor((y - min) / cellSize);
        r2 = Math.floor((y + 1 - min) / cellSize);
        for (x = 0; x < size; x += 1) {
          p = '█';

          if (min <= x && x < max && min <= y && y < max && _this.isDark(r1, Math.floor((x - min) / cellSize))) {
            p = ' ';
          }

          if (min <= x && x < max && min <= y+1 && y+1 < max && _this.isDark(r2, Math.floor((x - min) / cellSize))) {
            p += ' ';
          }
          else {
            p += '█';
          }

          // Output 2 characters per pixel, to create full square. 1 character per pixels gives only half width of square.
          ascii += (margin < 1 && y+1 >= max) ? blocksLastLineNoMargin[p] : blocks[p];
        }

        ascii += '\n';
      }

      if (size % 2 && margin > 0) {
        return ascii.substring(0, ascii.length - size - 1) + Array(size+1).join('▀');
      }

      return ascii.substring(0, ascii.length-1);
    };

    _this.createASCII = function(cellSize, margin) {
      cellSize = cellSize || 1;

      if (cellSize < 2) {
        return _createHalfASCII(margin);
      }

      cellSize -= 1;
      margin = (typeof margin == 'undefined')? cellSize * 2 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      var y, x, r, p;

      var white = Array(cellSize+1).join('██');
      var black = Array(cellSize+1).join('  ');

      var ascii = '';
      var line = '';
      for (y = 0; y < size; y += 1) {
        r = Math.floor( (y - min) / cellSize);
        line = '';
        for (x = 0; x < size; x += 1) {
          p = 1;

          if (min <= x && x < max && min <= y && y < max && _this.isDark(r, Math.floor((x - min) / cellSize))) {
            p = 0;
          }

          // Output 2 characters per pixel, to create full square. 1 character per pixels gives only half width of square.
          line += p ? white : black;
        }

        for (r = 0; r < cellSize; r += 1) {
          ascii += line + '\n';
        }
      }

      return ascii.substring(0, ascii.length-1);
    };

    _this.renderTo2dContext = function(context, cellSize) {
      cellSize = cellSize || 2;
      var length = _this.getModuleCount();
      for (var row = 0; row < length; row++) {
        for (var col = 0; col < length; col++) {
          context.fillStyle = _this.isDark(row, col) ? 'black' : 'white';
          context.fillRect(row * cellSize, col * cellSize, cellSize, cellSize);
        }
      }
    }

    return _this;
  };

  //---------------------------------------------------------------------
  // qrcode.stringToBytes
  //---------------------------------------------------------------------

  qrcode.stringToBytesFuncs = {
    'default' : function(s) {
      var bytes = [];
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charCodeAt(i);
        bytes.push(c & 0xff);
      }
      return bytes;
    }
  };

  qrcode.stringToBytes = qrcode.stringToBytesFuncs['default'];

  //---------------------------------------------------------------------
  // qrcode.createStringToBytes
  //---------------------------------------------------------------------

  /**
   * @param unicodeData base64 string of byte array.
   * [16bit Unicode],[16bit Bytes], ...
   * @param numChars
   */
  qrcode.createStringToBytes = function(unicodeData, numChars) {

    // create conversion map.

    var unicodeMap = function() {

      var bin = base64DecodeInputStream(unicodeData);
      var read = function() {
        var b = bin.read();
        if (b == -1) throw 'eof';
        return b;
      };

      var count = 0;
      var unicodeMap = {};
      while (true) {
        var b0 = bin.read();
        if (b0 == -1) break;
        var b1 = read();
        var b2 = read();
        var b3 = read();
        var k = String.fromCharCode( (b0 << 8) | b1);
        var v = (b2 << 8) | b3;
        unicodeMap[k] = v;
        count += 1;
      }
      if (count != numChars) {
        throw count + ' != ' + numChars;
      }

      return unicodeMap;
    }();

    var unknownChar = '?'.charCodeAt(0);

    return function(s) {
      var bytes = [];
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charCodeAt(i);
        if (c < 128) {
          bytes.push(c);
        } else {
          var b = unicodeMap[s.charAt(i)];
          if (typeof b == 'number') {
            if ( (b & 0xff) == b) {
              // 1byte
              bytes.push(b);
            } else {
              // 2bytes
              bytes.push(b >>> 8);
              bytes.push(b & 0xff);
            }
          } else {
            bytes.push(unknownChar);
          }
        }
      }
      return bytes;
    };
  };

  //---------------------------------------------------------------------
  // QRMode
  //---------------------------------------------------------------------

  var QRMode = {
    MODE_NUMBER :    1 << 0,
    MODE_ALPHA_NUM : 1 << 1,
    MODE_8BIT_BYTE : 1 << 2,
    MODE_KANJI :     1 << 3
  };

  //---------------------------------------------------------------------
  // QRErrorCorrectionLevel
  //---------------------------------------------------------------------

  var QRErrorCorrectionLevel = {
    L : 1,
    M : 0,
    Q : 3,
    H : 2
  };

  //---------------------------------------------------------------------
  // QRMaskPattern
  //---------------------------------------------------------------------

  var QRMaskPattern = {
    PATTERN000 : 0,
    PATTERN001 : 1,
    PATTERN010 : 2,
    PATTERN011 : 3,
    PATTERN100 : 4,
    PATTERN101 : 5,
    PATTERN110 : 6,
    PATTERN111 : 7
  };

  //---------------------------------------------------------------------
  // QRUtil
  //---------------------------------------------------------------------

  var QRUtil = function() {

    var PATTERN_POSITION_TABLE = [
      [],
      [6, 18],
      [6, 22],
      [6, 26],
      [6, 30],
      [6, 34],
      [6, 22, 38],
      [6, 24, 42],
      [6, 26, 46],
      [6, 28, 50],
      [6, 30, 54],
      [6, 32, 58],
      [6, 34, 62],
      [6, 26, 46, 66],
      [6, 26, 48, 70],
      [6, 26, 50, 74],
      [6, 30, 54, 78],
      [6, 30, 56, 82],
      [6, 30, 58, 86],
      [6, 34, 62, 90],
      [6, 28, 50, 72, 94],
      [6, 26, 50, 74, 98],
      [6, 30, 54, 78, 102],
      [6, 28, 54, 80, 106],
      [6, 32, 58, 84, 110],
      [6, 30, 58, 86, 114],
      [6, 34, 62, 90, 118],
      [6, 26, 50, 74, 98, 122],
      [6, 30, 54, 78, 102, 126],
      [6, 26, 52, 78, 104, 130],
      [6, 30, 56, 82, 108, 134],
      [6, 34, 60, 86, 112, 138],
      [6, 30, 58, 86, 114, 142],
      [6, 34, 62, 90, 118, 146],
      [6, 30, 54, 78, 102, 126, 150],
      [6, 24, 50, 76, 102, 128, 154],
      [6, 28, 54, 80, 106, 132, 158],
      [6, 32, 58, 84, 110, 136, 162],
      [6, 26, 54, 82, 110, 138, 166],
      [6, 30, 58, 86, 114, 142, 170]
    ];
    var G15 = (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0);
    var G18 = (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0);
    var G15_MASK = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);

    var _this = {};

    var getBCHDigit = function(data) {
      var digit = 0;
      while (data != 0) {
        digit += 1;
        data >>>= 1;
      }
      return digit;
    };

    _this.getBCHTypeInfo = function(data) {
      var d = data << 10;
      while (getBCHDigit(d) - getBCHDigit(G15) >= 0) {
        d ^= (G15 << (getBCHDigit(d) - getBCHDigit(G15) ) );
      }
      return ( (data << 10) | d) ^ G15_MASK;
    };

    _this.getBCHTypeNumber = function(data) {
      var d = data << 12;
      while (getBCHDigit(d) - getBCHDigit(G18) >= 0) {
        d ^= (G18 << (getBCHDigit(d) - getBCHDigit(G18) ) );
      }
      return (data << 12) | d;
    };

    _this.getPatternPosition = function(typeNumber) {
      return PATTERN_POSITION_TABLE[typeNumber - 1];
    };

    _this.getMaskFunction = function(maskPattern) {

      switch (maskPattern) {

      case QRMaskPattern.PATTERN000 :
        return function(i, j) { return (i + j) % 2 == 0; };
      case QRMaskPattern.PATTERN001 :
        return function(i, j) { return i % 2 == 0; };
      case QRMaskPattern.PATTERN010 :
        return function(i, j) { return j % 3 == 0; };
      case QRMaskPattern.PATTERN011 :
        return function(i, j) { return (i + j) % 3 == 0; };
      case QRMaskPattern.PATTERN100 :
        return function(i, j) { return (Math.floor(i / 2) + Math.floor(j / 3) ) % 2 == 0; };
      case QRMaskPattern.PATTERN101 :
        return function(i, j) { return (i * j) % 2 + (i * j) % 3 == 0; };
      case QRMaskPattern.PATTERN110 :
        return function(i, j) { return ( (i * j) % 2 + (i * j) % 3) % 2 == 0; };
      case QRMaskPattern.PATTERN111 :
        return function(i, j) { return ( (i * j) % 3 + (i + j) % 2) % 2 == 0; };

      default :
        throw 'bad maskPattern:' + maskPattern;
      }
    };

    _this.getErrorCorrectPolynomial = function(errorCorrectLength) {
      var a = qrPolynomial([1], 0);
      for (var i = 0; i < errorCorrectLength; i += 1) {
        a = a.multiply(qrPolynomial([1, QRMath.gexp(i)], 0) );
      }
      return a;
    };

    _this.getLengthInBits = function(mode, type) {

      if (1 <= type && type < 10) {

        // 1 - 9

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 10;
        case QRMode.MODE_ALPHA_NUM : return 9;
        case QRMode.MODE_8BIT_BYTE : return 8;
        case QRMode.MODE_KANJI     : return 8;
        default :
          throw 'mode:' + mode;
        }

      } else if (type < 27) {

        // 10 - 26

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 12;
        case QRMode.MODE_ALPHA_NUM : return 11;
        case QRMode.MODE_8BIT_BYTE : return 16;
        case QRMode.MODE_KANJI     : return 10;
        default :
          throw 'mode:' + mode;
        }

      } else if (type < 41) {

        // 27 - 40

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 14;
        case QRMode.MODE_ALPHA_NUM : return 13;
        case QRMode.MODE_8BIT_BYTE : return 16;
        case QRMode.MODE_KANJI     : return 12;
        default :
          throw 'mode:' + mode;
        }

      } else {
        throw 'type:' + type;
      }
    };

    _this.getLostPoint = function(qrcode) {

      var moduleCount = qrcode.getModuleCount();

      var lostPoint = 0;

      // LEVEL1

      for (var row = 0; row < moduleCount; row += 1) {
        for (var col = 0; col < moduleCount; col += 1) {

          var sameCount = 0;
          var dark = qrcode.isDark(row, col);

          for (var r = -1; r <= 1; r += 1) {

            if (row + r < 0 || moduleCount <= row + r) {
              continue;
            }

            for (var c = -1; c <= 1; c += 1) {

              if (col + c < 0 || moduleCount <= col + c) {
                continue;
              }

              if (r == 0 && c == 0) {
                continue;
              }

              if (dark == qrcode.isDark(row + r, col + c) ) {
                sameCount += 1;
              }
            }
          }

          if (sameCount > 5) {
            lostPoint += (3 + sameCount - 5);
          }
        }
      };

      // LEVEL2

      for (var row = 0; row < moduleCount - 1; row += 1) {
        for (var col = 0; col < moduleCount - 1; col += 1) {
          var count = 0;
          if (qrcode.isDark(row, col) ) count += 1;
          if (qrcode.isDark(row + 1, col) ) count += 1;
          if (qrcode.isDark(row, col + 1) ) count += 1;
          if (qrcode.isDark(row + 1, col + 1) ) count += 1;
          if (count == 0 || count == 4) {
            lostPoint += 3;
          }
        }
      }

      // LEVEL3

      for (var row = 0; row < moduleCount; row += 1) {
        for (var col = 0; col < moduleCount - 6; col += 1) {
          if (qrcode.isDark(row, col)
              && !qrcode.isDark(row, col + 1)
              &&  qrcode.isDark(row, col + 2)
              &&  qrcode.isDark(row, col + 3)
              &&  qrcode.isDark(row, col + 4)
              && !qrcode.isDark(row, col + 5)
              &&  qrcode.isDark(row, col + 6) ) {
            lostPoint += 40;
          }
        }
      }

      for (var col = 0; col < moduleCount; col += 1) {
        for (var row = 0; row < moduleCount - 6; row += 1) {
          if (qrcode.isDark(row, col)
              && !qrcode.isDark(row + 1, col)
              &&  qrcode.isDark(row + 2, col)
              &&  qrcode.isDark(row + 3, col)
              &&  qrcode.isDark(row + 4, col)
              && !qrcode.isDark(row + 5, col)
              &&  qrcode.isDark(row + 6, col) ) {
            lostPoint += 40;
          }
        }
      }

      // LEVEL4

      var darkCount = 0;

      for (var col = 0; col < moduleCount; col += 1) {
        for (var row = 0; row < moduleCount; row += 1) {
          if (qrcode.isDark(row, col) ) {
            darkCount += 1;
          }
        }
      }

      var ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
      lostPoint += ratio * 10;

      return lostPoint;
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // QRMath
  //---------------------------------------------------------------------

  var QRMath = function() {

    var EXP_TABLE = new Array(256);
    var LOG_TABLE = new Array(256);

    // initialize tables
    for (var i = 0; i < 8; i += 1) {
      EXP_TABLE[i] = 1 << i;
    }
    for (var i = 8; i < 256; i += 1) {
      EXP_TABLE[i] = EXP_TABLE[i - 4]
        ^ EXP_TABLE[i - 5]
        ^ EXP_TABLE[i - 6]
        ^ EXP_TABLE[i - 8];
    }
    for (var i = 0; i < 255; i += 1) {
      LOG_TABLE[EXP_TABLE[i] ] = i;
    }

    var _this = {};

    _this.glog = function(n) {

      if (n < 1) {
        throw 'glog(' + n + ')';
      }

      return LOG_TABLE[n];
    };

    _this.gexp = function(n) {

      while (n < 0) {
        n += 255;
      }

      while (n >= 256) {
        n -= 255;
      }

      return EXP_TABLE[n];
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // qrPolynomial
  //---------------------------------------------------------------------

  function qrPolynomial(num, shift) {

    if (typeof num.length == 'undefined') {
      throw num.length + '/' + shift;
    }

    var _num = function() {
      var offset = 0;
      while (offset < num.length && num[offset] == 0) {
        offset += 1;
      }
      var _num = new Array(num.length - offset + shift);
      for (var i = 0; i < num.length - offset; i += 1) {
        _num[i] = num[i + offset];
      }
      return _num;
    }();

    var _this = {};

    _this.getAt = function(index) {
      return _num[index];
    };

    _this.getLength = function() {
      return _num.length;
    };

    _this.multiply = function(e) {

      var num = new Array(_this.getLength() + e.getLength() - 1);

      for (var i = 0; i < _this.getLength(); i += 1) {
        for (var j = 0; j < e.getLength(); j += 1) {
          num[i + j] ^= QRMath.gexp(QRMath.glog(_this.getAt(i) ) + QRMath.glog(e.getAt(j) ) );
        }
      }

      return qrPolynomial(num, 0);
    };

    _this.mod = function(e) {

      if (_this.getLength() - e.getLength() < 0) {
        return _this;
      }

      var ratio = QRMath.glog(_this.getAt(0) ) - QRMath.glog(e.getAt(0) );

      var num = new Array(_this.getLength() );
      for (var i = 0; i < _this.getLength(); i += 1) {
        num[i] = _this.getAt(i);
      }

      for (var i = 0; i < e.getLength(); i += 1) {
        num[i] ^= QRMath.gexp(QRMath.glog(e.getAt(i) ) + ratio);
      }

      // recursive call
      return qrPolynomial(num, 0).mod(e);
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // QRRSBlock
  //---------------------------------------------------------------------

  var QRRSBlock = function() {

    var RS_BLOCK_TABLE = [

      // L
      // M
      // Q
      // H

      // 1
      [1, 26, 19],
      [1, 26, 16],
      [1, 26, 13],
      [1, 26, 9],

      // 2
      [1, 44, 34],
      [1, 44, 28],
      [1, 44, 22],
      [1, 44, 16],

      // 3
      [1, 70, 55],
      [1, 70, 44],
      [2, 35, 17],
      [2, 35, 13],

      // 4
      [1, 100, 80],
      [2, 50, 32],
      [2, 50, 24],
      [4, 25, 9],

      // 5
      [1, 134, 108],
      [2, 67, 43],
      [2, 33, 15, 2, 34, 16],
      [2, 33, 11, 2, 34, 12],

      // 6
      [2, 86, 68],
      [4, 43, 27],
      [4, 43, 19],
      [4, 43, 15],

      // 7
      [2, 98, 78],
      [4, 49, 31],
      [2, 32, 14, 4, 33, 15],
      [4, 39, 13, 1, 40, 14],

      // 8
      [2, 121, 97],
      [2, 60, 38, 2, 61, 39],
      [4, 40, 18, 2, 41, 19],
      [4, 40, 14, 2, 41, 15],

      // 9
      [2, 146, 116],
      [3, 58, 36, 2, 59, 37],
      [4, 36, 16, 4, 37, 17],
      [4, 36, 12, 4, 37, 13],

      // 10
      [2, 86, 68, 2, 87, 69],
      [4, 69, 43, 1, 70, 44],
      [6, 43, 19, 2, 44, 20],
      [6, 43, 15, 2, 44, 16],

      // 11
      [4, 101, 81],
      [1, 80, 50, 4, 81, 51],
      [4, 50, 22, 4, 51, 23],
      [3, 36, 12, 8, 37, 13],

      // 12
      [2, 116, 92, 2, 117, 93],
      [6, 58, 36, 2, 59, 37],
      [4, 46, 20, 6, 47, 21],
      [7, 42, 14, 4, 43, 15],

      // 13
      [4, 133, 107],
      [8, 59, 37, 1, 60, 38],
      [8, 44, 20, 4, 45, 21],
      [12, 33, 11, 4, 34, 12],

      // 14
      [3, 145, 115, 1, 146, 116],
      [4, 64, 40, 5, 65, 41],
      [11, 36, 16, 5, 37, 17],
      [11, 36, 12, 5, 37, 13],

      // 15
      [5, 109, 87, 1, 110, 88],
      [5, 65, 41, 5, 66, 42],
      [5, 54, 24, 7, 55, 25],
      [11, 36, 12, 7, 37, 13],

      // 16
      [5, 122, 98, 1, 123, 99],
      [7, 73, 45, 3, 74, 46],
      [15, 43, 19, 2, 44, 20],
      [3, 45, 15, 13, 46, 16],

      // 17
      [1, 135, 107, 5, 136, 108],
      [10, 74, 46, 1, 75, 47],
      [1, 50, 22, 15, 51, 23],
      [2, 42, 14, 17, 43, 15],

      // 18
      [5, 150, 120, 1, 151, 121],
      [9, 69, 43, 4, 70, 44],
      [17, 50, 22, 1, 51, 23],
      [2, 42, 14, 19, 43, 15],

      // 19
      [3, 141, 113, 4, 142, 114],
      [3, 70, 44, 11, 71, 45],
      [17, 47, 21, 4, 48, 22],
      [9, 39, 13, 16, 40, 14],

      // 20
      [3, 135, 107, 5, 136, 108],
      [3, 67, 41, 13, 68, 42],
      [15, 54, 24, 5, 55, 25],
      [15, 43, 15, 10, 44, 16],

      // 21
      [4, 144, 116, 4, 145, 117],
      [17, 68, 42],
      [17, 50, 22, 6, 51, 23],
      [19, 46, 16, 6, 47, 17],

      // 22
      [2, 139, 111, 7, 140, 112],
      [17, 74, 46],
      [7, 54, 24, 16, 55, 25],
      [34, 37, 13],

      // 23
      [4, 151, 121, 5, 152, 122],
      [4, 75, 47, 14, 76, 48],
      [11, 54, 24, 14, 55, 25],
      [16, 45, 15, 14, 46, 16],

      // 24
      [6, 147, 117, 4, 148, 118],
      [6, 73, 45, 14, 74, 46],
      [11, 54, 24, 16, 55, 25],
      [30, 46, 16, 2, 47, 17],

      // 25
      [8, 132, 106, 4, 133, 107],
      [8, 75, 47, 13, 76, 48],
      [7, 54, 24, 22, 55, 25],
      [22, 45, 15, 13, 46, 16],

      // 26
      [10, 142, 114, 2, 143, 115],
      [19, 74, 46, 4, 75, 47],
      [28, 50, 22, 6, 51, 23],
      [33, 46, 16, 4, 47, 17],

      // 27
      [8, 152, 122, 4, 153, 123],
      [22, 73, 45, 3, 74, 46],
      [8, 53, 23, 26, 54, 24],
      [12, 45, 15, 28, 46, 16],

      // 28
      [3, 147, 117, 10, 148, 118],
      [3, 73, 45, 23, 74, 46],
      [4, 54, 24, 31, 55, 25],
      [11, 45, 15, 31, 46, 16],

      // 29
      [7, 146, 116, 7, 147, 117],
      [21, 73, 45, 7, 74, 46],
      [1, 53, 23, 37, 54, 24],
      [19, 45, 15, 26, 46, 16],

      // 30
      [5, 145, 115, 10, 146, 116],
      [19, 75, 47, 10, 76, 48],
      [15, 54, 24, 25, 55, 25],
      [23, 45, 15, 25, 46, 16],

      // 31
      [13, 145, 115, 3, 146, 116],
      [2, 74, 46, 29, 75, 47],
      [42, 54, 24, 1, 55, 25],
      [23, 45, 15, 28, 46, 16],

      // 32
      [17, 145, 115],
      [10, 74, 46, 23, 75, 47],
      [10, 54, 24, 35, 55, 25],
      [19, 45, 15, 35, 46, 16],

      // 33
      [17, 145, 115, 1, 146, 116],
      [14, 74, 46, 21, 75, 47],
      [29, 54, 24, 19, 55, 25],
      [11, 45, 15, 46, 46, 16],

      // 34
      [13, 145, 115, 6, 146, 116],
      [14, 74, 46, 23, 75, 47],
      [44, 54, 24, 7, 55, 25],
      [59, 46, 16, 1, 47, 17],

      // 35
      [12, 151, 121, 7, 152, 122],
      [12, 75, 47, 26, 76, 48],
      [39, 54, 24, 14, 55, 25],
      [22, 45, 15, 41, 46, 16],

      // 36
      [6, 151, 121, 14, 152, 122],
      [6, 75, 47, 34, 76, 48],
      [46, 54, 24, 10, 55, 25],
      [2, 45, 15, 64, 46, 16],

      // 37
      [17, 152, 122, 4, 153, 123],
      [29, 74, 46, 14, 75, 47],
      [49, 54, 24, 10, 55, 25],
      [24, 45, 15, 46, 46, 16],

      // 38
      [4, 152, 122, 18, 153, 123],
      [13, 74, 46, 32, 75, 47],
      [48, 54, 24, 14, 55, 25],
      [42, 45, 15, 32, 46, 16],

      // 39
      [20, 147, 117, 4, 148, 118],
      [40, 75, 47, 7, 76, 48],
      [43, 54, 24, 22, 55, 25],
      [10, 45, 15, 67, 46, 16],

      // 40
      [19, 148, 118, 6, 149, 119],
      [18, 75, 47, 31, 76, 48],
      [34, 54, 24, 34, 55, 25],
      [20, 45, 15, 61, 46, 16]
    ];

    var qrRSBlock = function(totalCount, dataCount) {
      var _this = {};
      _this.totalCount = totalCount;
      _this.dataCount = dataCount;
      return _this;
    };

    var _this = {};

    var getRsBlockTable = function(typeNumber, errorCorrectionLevel) {

      switch(errorCorrectionLevel) {
      case QRErrorCorrectionLevel.L :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
      case QRErrorCorrectionLevel.M :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
      case QRErrorCorrectionLevel.Q :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
      case QRErrorCorrectionLevel.H :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
      default :
        return undefined;
      }
    };

    _this.getRSBlocks = function(typeNumber, errorCorrectionLevel) {

      var rsBlock = getRsBlockTable(typeNumber, errorCorrectionLevel);

      if (typeof rsBlock == 'undefined') {
        throw 'bad rs block @ typeNumber:' + typeNumber +
            '/errorCorrectionLevel:' + errorCorrectionLevel;
      }

      var length = rsBlock.length / 3;

      var list = [];

      for (var i = 0; i < length; i += 1) {

        var count = rsBlock[i * 3 + 0];
        var totalCount = rsBlock[i * 3 + 1];
        var dataCount = rsBlock[i * 3 + 2];

        for (var j = 0; j < count; j += 1) {
          list.push(qrRSBlock(totalCount, dataCount) );
        }
      }

      return list;
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // qrBitBuffer
  //---------------------------------------------------------------------

  var qrBitBuffer = function() {

    var _buffer = [];
    var _length = 0;

    var _this = {};

    _this.getBuffer = function() {
      return _buffer;
    };

    _this.getAt = function(index) {
      var bufIndex = Math.floor(index / 8);
      return ( (_buffer[bufIndex] >>> (7 - index % 8) ) & 1) == 1;
    };

    _this.put = function(num, length) {
      for (var i = 0; i < length; i += 1) {
        _this.putBit( ( (num >>> (length - i - 1) ) & 1) == 1);
      }
    };

    _this.getLengthInBits = function() {
      return _length;
    };

    _this.putBit = function(bit) {

      var bufIndex = Math.floor(_length / 8);
      if (_buffer.length <= bufIndex) {
        _buffer.push(0);
      }

      if (bit) {
        _buffer[bufIndex] |= (0x80 >>> (_length % 8) );
      }

      _length += 1;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrNumber
  //---------------------------------------------------------------------

  var qrNumber = function(data) {

    var _mode = QRMode.MODE_NUMBER;
    var _data = data;

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _data.length;
    };

    _this.write = function(buffer) {

      var data = _data;

      var i = 0;

      while (i + 2 < data.length) {
        buffer.put(strToNum(data.substring(i, i + 3) ), 10);
        i += 3;
      }

      if (i < data.length) {
        if (data.length - i == 1) {
          buffer.put(strToNum(data.substring(i, i + 1) ), 4);
        } else if (data.length - i == 2) {
          buffer.put(strToNum(data.substring(i, i + 2) ), 7);
        }
      }
    };

    var strToNum = function(s) {
      var num = 0;
      for (var i = 0; i < s.length; i += 1) {
        num = num * 10 + chatToNum(s.charAt(i) );
      }
      return num;
    };

    var chatToNum = function(c) {
      if ('0' <= c && c <= '9') {
        return c.charCodeAt(0) - '0'.charCodeAt(0);
      }
      throw 'illegal char :' + c;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrAlphaNum
  //---------------------------------------------------------------------

  var qrAlphaNum = function(data) {

    var _mode = QRMode.MODE_ALPHA_NUM;
    var _data = data;

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _data.length;
    };

    _this.write = function(buffer) {

      var s = _data;

      var i = 0;

      while (i + 1 < s.length) {
        buffer.put(
          getCode(s.charAt(i) ) * 45 +
          getCode(s.charAt(i + 1) ), 11);
        i += 2;
      }

      if (i < s.length) {
        buffer.put(getCode(s.charAt(i) ), 6);
      }
    };

    var getCode = function(c) {

      if ('0' <= c && c <= '9') {
        return c.charCodeAt(0) - '0'.charCodeAt(0);
      } else if ('A' <= c && c <= 'Z') {
        return c.charCodeAt(0) - 'A'.charCodeAt(0) + 10;
      } else {
        switch (c) {
        case ' ' : return 36;
        case '$' : return 37;
        case '%' : return 38;
        case '*' : return 39;
        case '+' : return 40;
        case '-' : return 41;
        case '.' : return 42;
        case '/' : return 43;
        case ':' : return 44;
        default :
          throw 'illegal char :' + c;
        }
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qr8BitByte
  //---------------------------------------------------------------------

  var qr8BitByte = function(data) {

    var _mode = QRMode.MODE_8BIT_BYTE;
    var _data = data;
    var _bytes = qrcode.stringToBytes(data);

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _bytes.length;
    };

    _this.write = function(buffer) {
      for (var i = 0; i < _bytes.length; i += 1) {
        buffer.put(_bytes[i], 8);
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrKanji
  //---------------------------------------------------------------------

  var qrKanji = function(data) {

    var _mode = QRMode.MODE_KANJI;
    var _data = data;

    var stringToBytes = qrcode.stringToBytesFuncs['SJIS'];
    if (!stringToBytes) {
      throw 'sjis not supported.';
    }
    !function(c, code) {
      // self test for sjis support.
      var test = stringToBytes(c);
      if (test.length != 2 || ( (test[0] << 8) | test[1]) != code) {
        throw 'sjis not supported.';
      }
    }('\u53cb', 0x9746);

    var _bytes = stringToBytes(data);

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return ~~(_bytes.length / 2);
    };

    _this.write = function(buffer) {

      var data = _bytes;

      var i = 0;

      while (i + 1 < data.length) {

        var c = ( (0xff & data[i]) << 8) | (0xff & data[i + 1]);

        if (0x8140 <= c && c <= 0x9FFC) {
          c -= 0x8140;
        } else if (0xE040 <= c && c <= 0xEBBF) {
          c -= 0xC140;
        } else {
          throw 'illegal char at ' + (i + 1) + '/' + c;
        }

        c = ( (c >>> 8) & 0xff) * 0xC0 + (c & 0xff);

        buffer.put(c, 13);

        i += 2;
      }

      if (i < data.length) {
        throw 'illegal char at ' + (i + 1);
      }
    };

    return _this;
  };

  //=====================================================================
  // GIF Support etc.
  //

  //---------------------------------------------------------------------
  // byteArrayOutputStream
  //---------------------------------------------------------------------

  var byteArrayOutputStream = function() {

    var _bytes = [];

    var _this = {};

    _this.writeByte = function(b) {
      _bytes.push(b & 0xff);
    };

    _this.writeShort = function(i) {
      _this.writeByte(i);
      _this.writeByte(i >>> 8);
    };

    _this.writeBytes = function(b, off, len) {
      off = off || 0;
      len = len || b.length;
      for (var i = 0; i < len; i += 1) {
        _this.writeByte(b[i + off]);
      }
    };

    _this.writeString = function(s) {
      for (var i = 0; i < s.length; i += 1) {
        _this.writeByte(s.charCodeAt(i) );
      }
    };

    _this.toByteArray = function() {
      return _bytes;
    };

    _this.toString = function() {
      var s = '';
      s += '[';
      for (var i = 0; i < _bytes.length; i += 1) {
        if (i > 0) {
          s += ',';
        }
        s += _bytes[i];
      }
      s += ']';
      return s;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // base64EncodeOutputStream
  //---------------------------------------------------------------------

  var base64EncodeOutputStream = function() {

    var _buffer = 0;
    var _buflen = 0;
    var _length = 0;
    var _base64 = '';

    var _this = {};

    var writeEncoded = function(b) {
      _base64 += String.fromCharCode(encode(b & 0x3f) );
    };

    var encode = function(n) {
      if (n < 0) {
        // error.
      } else if (n < 26) {
        return 0x41 + n;
      } else if (n < 52) {
        return 0x61 + (n - 26);
      } else if (n < 62) {
        return 0x30 + (n - 52);
      } else if (n == 62) {
        return 0x2b;
      } else if (n == 63) {
        return 0x2f;
      }
      throw 'n:' + n;
    };

    _this.writeByte = function(n) {

      _buffer = (_buffer << 8) | (n & 0xff);
      _buflen += 8;
      _length += 1;

      while (_buflen >= 6) {
        writeEncoded(_buffer >>> (_buflen - 6) );
        _buflen -= 6;
      }
    };

    _this.flush = function() {

      if (_buflen > 0) {
        writeEncoded(_buffer << (6 - _buflen) );
        _buffer = 0;
        _buflen = 0;
      }

      if (_length % 3 != 0) {
        // padding
        var padlen = 3 - _length % 3;
        for (var i = 0; i < padlen; i += 1) {
          _base64 += '=';
        }
      }
    };

    _this.toString = function() {
      return _base64;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // base64DecodeInputStream
  //---------------------------------------------------------------------

  var base64DecodeInputStream = function(str) {

    var _str = str;
    var _pos = 0;
    var _buffer = 0;
    var _buflen = 0;

    var _this = {};

    _this.read = function() {

      while (_buflen < 8) {

        if (_pos >= _str.length) {
          if (_buflen == 0) {
            return -1;
          }
          throw 'unexpected end of file./' + _buflen;
        }

        var c = _str.charAt(_pos);
        _pos += 1;

        if (c == '=') {
          _buflen = 0;
          return -1;
        } else if (c.match(/^\s$/) ) {
          // ignore if whitespace.
          continue;
        }

        _buffer = (_buffer << 6) | decode(c.charCodeAt(0) );
        _buflen += 6;
      }

      var n = (_buffer >>> (_buflen - 8) ) & 0xff;
      _buflen -= 8;
      return n;
    };

    var decode = function(c) {
      if (0x41 <= c && c <= 0x5a) {
        return c - 0x41;
      } else if (0x61 <= c && c <= 0x7a) {
        return c - 0x61 + 26;
      } else if (0x30 <= c && c <= 0x39) {
        return c - 0x30 + 52;
      } else if (c == 0x2b) {
        return 62;
      } else if (c == 0x2f) {
        return 63;
      } else {
        throw 'c:' + c;
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // gifImage (B/W)
  //---------------------------------------------------------------------

  var gifImage = function(width, height) {

    var _width = width;
    var _height = height;
    var _data = new Array(width * height);

    var _this = {};

    _this.setPixel = function(x, y, pixel) {
      _data[y * _width + x] = pixel;
    };

    _this.write = function(out) {

      //---------------------------------
      // GIF Signature

      out.writeString('GIF87a');

      //---------------------------------
      // Screen Descriptor

      out.writeShort(_width);
      out.writeShort(_height);

      out.writeByte(0x80); // 2bit
      out.writeByte(0);
      out.writeByte(0);

      //---------------------------------
      // Global Color Map

      // black
      out.writeByte(0x00);
      out.writeByte(0x00);
      out.writeByte(0x00);

      // white
      out.writeByte(0xff);
      out.writeByte(0xff);
      out.writeByte(0xff);

      //---------------------------------
      // Image Descriptor

      out.writeString(',');
      out.writeShort(0);
      out.writeShort(0);
      out.writeShort(_width);
      out.writeShort(_height);
      out.writeByte(0);

      //---------------------------------
      // Local Color Map

      //---------------------------------
      // Raster Data

      var lzwMinCodeSize = 2;
      var raster = getLZWRaster(lzwMinCodeSize);

      out.writeByte(lzwMinCodeSize);

      var offset = 0;

      while (raster.length - offset > 255) {
        out.writeByte(255);
        out.writeBytes(raster, offset, 255);
        offset += 255;
      }

      out.writeByte(raster.length - offset);
      out.writeBytes(raster, offset, raster.length - offset);
      out.writeByte(0x00);

      //---------------------------------
      // GIF Terminator
      out.writeString(';');
    };

    var bitOutputStream = function(out) {

      var _out = out;
      var _bitLength = 0;
      var _bitBuffer = 0;

      var _this = {};

      _this.write = function(data, length) {

        if ( (data >>> length) != 0) {
          throw 'length over';
        }

        while (_bitLength + length >= 8) {
          _out.writeByte(0xff & ( (data << _bitLength) | _bitBuffer) );
          length -= (8 - _bitLength);
          data >>>= (8 - _bitLength);
          _bitBuffer = 0;
          _bitLength = 0;
        }

        _bitBuffer = (data << _bitLength) | _bitBuffer;
        _bitLength = _bitLength + length;
      };

      _this.flush = function() {
        if (_bitLength > 0) {
          _out.writeByte(_bitBuffer);
        }
      };

      return _this;
    };

    var getLZWRaster = function(lzwMinCodeSize) {

      var clearCode = 1 << lzwMinCodeSize;
      var endCode = (1 << lzwMinCodeSize) + 1;
      var bitLength = lzwMinCodeSize + 1;

      // Setup LZWTable
      var table = lzwTable();

      for (var i = 0; i < clearCode; i += 1) {
        table.add(String.fromCharCode(i) );
      }
      table.add(String.fromCharCode(clearCode) );
      table.add(String.fromCharCode(endCode) );

      var byteOut = byteArrayOutputStream();
      var bitOut = bitOutputStream(byteOut);

      // clear code
      bitOut.write(clearCode, bitLength);

      var dataIndex = 0;

      var s = String.fromCharCode(_data[dataIndex]);
      dataIndex += 1;

      while (dataIndex < _data.length) {

        var c = String.fromCharCode(_data[dataIndex]);
        dataIndex += 1;

        if (table.contains(s + c) ) {

          s = s + c;

        } else {

          bitOut.write(table.indexOf(s), bitLength);

          if (table.size() < 0xfff) {

            if (table.size() == (1 << bitLength) ) {
              bitLength += 1;
            }

            table.add(s + c);
          }

          s = c;
        }
      }

      bitOut.write(table.indexOf(s), bitLength);

      // end code
      bitOut.write(endCode, bitLength);

      bitOut.flush();

      return byteOut.toByteArray();
    };

    var lzwTable = function() {

      var _map = {};
      var _size = 0;

      var _this = {};

      _this.add = function(key) {
        if (_this.contains(key) ) {
          throw 'dup key:' + key;
        }
        _map[key] = _size;
        _size += 1;
      };

      _this.size = function() {
        return _size;
      };

      _this.indexOf = function(key) {
        return _map[key];
      };

      _this.contains = function(key) {
        return typeof _map[key] != 'undefined';
      };

      return _this;
    };

    return _this;
  };

  var createDataURL = function(width, height, getPixel) {
    var gif = gifImage(width, height);
    for (var y = 0; y < height; y += 1) {
      for (var x = 0; x < width; x += 1) {
        gif.setPixel(x, y, getPixel(x, y) );
      }
    }

    var b = byteArrayOutputStream();
    gif.write(b);

    var base64 = base64EncodeOutputStream();
    var bytes = b.toByteArray();
    for (var i = 0; i < bytes.length; i += 1) {
      base64.writeByte(bytes[i]);
    }
    base64.flush();

    return 'data:image/gif;base64,' + base64;
  };

  //---------------------------------------------------------------------
  // returns qrcode function.

  return qrcode;
}();

// multibyte support
!function() {

  qrcode.stringToBytesFuncs['UTF-8'] = function(s) {
    // http://stackoverflow.com/questions/18729405/how-to-convert-utf8-string-to-byte-array
    function toUTF8Array(str) {
      var utf8 = [];
      for (var i=0; i < str.length; i++) {
        var charcode = str.charCodeAt(i);
        if (charcode < 0x80) utf8.push(charcode);
        else if (charcode < 0x800) {
          utf8.push(0xc0 | (charcode >> 6),
              0x80 | (charcode & 0x3f));
        }
        else if (charcode < 0xd800 || charcode >= 0xe000) {
          utf8.push(0xe0 | (charcode >> 12),
              0x80 | ((charcode>>6) & 0x3f),
              0x80 | (charcode & 0x3f));
        }
        // surrogate pair
        else {
          i++;
          // UTF-16 encodes 0x10000-0x10FFFF by
          // subtracting 0x10000 and splitting the
          // 20 bits of 0x0-0xFFFFF into two halves
          charcode = 0x10000 + (((charcode & 0x3ff)<<10)
            | (str.charCodeAt(i) & 0x3ff));
          utf8.push(0xf0 | (charcode >>18),
              0x80 | ((charcode>>12) & 0x3f),
              0x80 | ((charcode>>6) & 0x3f),
              0x80 | (charcode & 0x3f));
        }
      }
      return utf8;
    }
    return toUTF8Array(s);
  };

}();

(function (factory) {
  if (typeof define === 'function' && define.amd) {
      define([], factory);
  } else if (typeof exports === 'object') {
      module.exports = factory();
  }
}(function () {
    return qrcode;
}));

// Voir ionic-stubs.ts : @ionic/angular/standalone charge tout son bundle
// (dont une ligne d'import ESM cassée sous Vitest, ionic-team/ionic-framework#30982)
// dès qu'on en importe quoi que ce soit. Ce mock global intercepte l'import
// avant que le vrai bundle ne soit chargé, pour TOUS les specs — pas besoin
// de le répéter dans chaque fichier (voir angular.json, test.options.setupFiles).
//
// Factory async avec import() dynamique, pas un import statique en haut de
// fichier : vi.mock() est hoisté par Vitest au-dessus de tous les imports,
// donc une référence à un import statique ici lirait une liaison pas encore
// initialisée (TDZ) — le import() dynamique s'exécute, lui, au moment de
// l'appel réel de la factory, pas au chargement du module.
vi.mock('@ionic/angular/standalone', async () => {
  const stubs = await import('./ionic-stubs');
  return {
    IonButton: stubs.IonButtonStub,
    IonIcon: stubs.IonIconStub,
    IonInput: stubs.IonInputStub,
    IonItem: stubs.IonItemStub,
    IonItemOption: stubs.IonItemOptionStub,
    IonItemOptions: stubs.IonItemOptionsStub,
    IonItemSliding: stubs.IonItemSlidingStub,
    IonLabel: stubs.IonLabelStub,
    IonSpinner: stubs.IonSpinnerStub,
    IonChip: stubs.IonChipStub,
    IonBadge: stubs.IonBadgeStub,
    ModalController: stubs.ModalControllerStub,
    ActionSheetController: stubs.ActionSheetControllerStub,
    ToastController: stubs.ToastControllerStub,
    IonHeader: stubs.IonHeaderStub,
    IonToolbar: stubs.IonToolbarStub,
    IonTitle: stubs.IonTitleStub,
    IonButtons: stubs.IonButtonsStub,
    IonContent: stubs.IonContentStub,
    IonList: stubs.IonListStub,
    IonNote: stubs.IonNoteStub,
    IonText: stubs.IonTextStub,
    IonFab: stubs.IonFabStub,
    IonFabButton: stubs.IonFabButtonStub,
    IonSelect: stubs.IonSelectStub,
    IonSelectOption: stubs.IonSelectOptionStub,
    IonSegment: stubs.IonSegmentStub,
    IonSegmentButton: stubs.IonSegmentButtonStub,
  };
});

// Module classique (distinct de `/standalone`) : mêmes symptômes, mêmes
// raisons (voir ci-dessus). N'exporte ici que ce qu'un composant testé
// consomme réellement aujourd'hui (`Platform`) — à enrichir au même rythme
// que ionic-stubs.ts.
vi.mock('@ionic/angular', async () => {
  const stubs = await import('./ionic-stubs');
  return {
    Platform: stubs.PlatformStub,
  };
});

export const sampleArticle = {
  id: 'turkey-emergency-rate-intervention-2026',
  title: 'Turkey emergency central-bank intervention',
  sourceDate: 'Not provided',
  sourceText:
    'Dunya reports that Turkiye Cumhuriyet Merkez Bankasi officials are preparing an emergency liquidity and policy-rate intervention before 2026-06-15 after renewed pressure on the lira. Merkez Bankasi kaynaklari, karar metninin haftalik PPK toplantisi disinda yayimlanabilecegini ve duyurunun resmi TCMB sayfasindan yapilacagini belirtti. The official resolver page named in the report is the TCMB website at https://www.tcmb.gov.tr/.',
} as const;

export const sampleArticles = [
  sampleArticle,
  {
    id: 'argentina-currency-controls-2026',
    title: 'Argentina currency controls decision',
    sourceText:
      'La Nacion reports that Banco Central de la Republica Argentina and Economy Ministry officials are preparing a decree to remove remaining currency controls before 2026-07-01. Funcionarios dijeron que la medida se publicaria en el Boletin Oficial y en comunicaciones del BCRA si el gabinete aprueba el calendario.',
  },
  {
    id: 'chile-lithium-permit-decision-2026',
    title: 'Chile lithium permit decision',
    sourceText:
      'Diario Financiero reports that Chilean mining ministry officials expect to publish a lithium extraction permit decision before 2026-08-15 after the election review period. The ministry said any approval or rejection would appear in an official ministry resolution.',
  },
] as const;

export const sampleArticleText = sampleArticle.sourceText;

export const sampleArticle = {
  id: 'chile-laguna-verde-ceol-ratification-2026',
  title: 'Chile Laguna Verde CEOL ratification',
  sourceDate: '2026-05-18',
  sourceText:
    'Diario Financiero Chile informa que el Ministerio de Mineria y Minera Laguna Verde acordaron los terminos de un CEOL para explotar litio en la zona de Laguna Verde, pero la ratificacion oficial del Gobierno y la toma de razon de Contraloria siguen pendientes. Funcionarios indicaron que el acuerdo podria publicarse antes del 2026-06-30 si se completa la revision administrativa. La fuente oficial de resolucion seria una publicacion del Gobierno de Chile o de la Contraloria General de la Republica en https://www.contraloria.cl/.',
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

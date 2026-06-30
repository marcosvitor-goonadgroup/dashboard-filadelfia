import axios from 'axios';
import { ApiResponse, ProcessedCampaignData, ProcessedSearchData, PricingTableRow } from '../types/campaign';
import { parse } from 'date-fns';

// Em dev usa proxy do Vite (evita CORS); em produção chama a API diretamente
const API_BASE = import.meta.env.DEV
  ? '/api-proxy'
  : 'https://nmbcoamazonia-api.vercel.app';

// Planilha Consolidada da Filadélfia Comunicação (Prefeitura de Contagem)
const CONSOLIDADO_API_URLS = [
  `${API_BASE}/google/sheets/12yXqtGSvmWUPcTyQnb35bBv58Vge6pSKJXwiuaCanik/data?range=Consolidado`
];

// Planilhas Consolidadas no layout de 28 colunas (IBMR, SENAC e similares)
const CONSOLIDADO_28COL_API_URLS = [
  `${API_BASE}/google/sheets/1E7f7LSolcxPtBh_nf-RuED1WgCc1miZmJXvL1p9TWXY/data?range=Consolidado`, // IBMR
  `${API_BASE}/google/sheets/16TGjNpG3VPJ5mnbgDaVjNxtOrV9DR7Fk_Xc7lbt1c3k/data?range=Consolidado`  // SENAC
];

const SEARCH_API_URLS = [
  `${API_BASE}/google/sheets/1abcar-ESRB_f8ytKGQ_ru_slZ67cXhjxKt8gL7TrEVw/data?range=Search`,
  `${API_BASE}/google/sheets/1HykUxjCGGdveDS_5vlLOOkAq7Wkl058453xkYGTAzNM/data?range=Search`
];

const PRICING_API_URL = `${API_BASE}/google/sheets/1zgRBEs_qi_9DdYLqw-cEedD1u66FS88ku6zTZ0gV-oU/data?range=base`;

const PI_INFO_API_URL = `${API_BASE}/google/sheets/1T35Pzw9ZA5NOTLHsTqMGZL5IEedpSGdZHJ2ElrqLs1M/data`;

const parseNumber = (value: string): number => {
  if (!value || value === '') return 0;
  const cleaned = value.replace(/\./g, '').replace(',', '.');
  return parseFloat(cleaned) || 0;
};

const parseCurrency = (value: string): number => {
  if (!value || value === '') return 0;
  // Remove "R$" e espaços, depois processa como número
  const cleaned = value.replace('R$', '').trim().replace(/\./g, '').replace(',', '.');
  return parseFloat(cleaned) || 0;
};

const parsePercentage = (value: string): number => {
  if (!value || value === '') return 0;
  // Remove "%" e converte para decimal
  const cleaned = value.replace('%', '').trim().replace(',', '.');
  return parseFloat(cleaned) || 0;
};

const parseSearchDate = (dateString: string): Date => {
  try {
    // Format from API: "2025-04-08"
    return parse(dateString, 'yyyy-MM-dd', new Date());
  } catch {
    return new Date();
  }
};

const normalizeVeiculo = (veiculo: string): string => {
  const normalized = veiculo.trim();
  const lower = normalized.toLowerCase();
  if (lower === 'audience network' || lower === 'messenger' || lower === 'threads' || lower === 'unknown') {
    return 'Facebook';
  }
  return normalized;
};

const parseConsolidadoDate = (dateString: string): Date => {
  try {
    // Formato da planilha Consolidado: "DD/MM/YYYY"
    return parse(dateString, 'dd/MM/yyyy', new Date());
  } catch {
    return new Date();
  }
};

// Normaliza o nome da agência exibido no painel.
const normalizeAgencia = (agencia: string): string => {
  const normalized = agencia.trim();
  if (/^filad[eé]lfia/i.test(normalized)) {
    return 'Filadélfia Comunicação';
  }
  return normalized;
};

// Formato "Consolidado" — 25 colunas:
// [0] Date, [1] Campaign name, [2] Ad Set Name, [3] Ad Name, [4] Cost,
// [5] Impressions, [6] Reach, [7] Clicks, [8] Video views, [9] Video views 25%,
// [10] Video views 50%, [11] Video views 75%, [12] Video completions,
// [13] Total engagements, [14] video_estatico_audio, [15] Image, [16] Agência,
// [17] Veículo, [18] Número PI, [19] Tipo de Compra, [20] Investimento,
// [21] Formato, [22] Campanha, [23] Localização, [24] Cliente
const parseConsolidadoRows = (rows: string[][]): ProcessedCampaignData[] => {
  const data: ProcessedCampaignData[] = [];
  rows.forEach(row => {
    if (row.length < 23) return;
    const numeroPi = row[18] || '';
    if (numeroPi === '#VALUE!') return;

    data.push({
      date: parseConsolidadoDate(row[0]),
      campaignName: row[1] || '',
      adSetName: row[2] || '',
      adName: row[3] || '',
      cost: parseCurrency(row[20]),          // coluna Investimento
      impressions: parseNumber(row[5]),
      reach: parseNumber(row[6]),
      clicks: parseNumber(row[7]),
      videoViews: parseNumber(row[8]),
      videoViews25: parseNumber(row[9]),
      videoViews50: parseNumber(row[10]),
      videoViews75: parseNumber(row[11]),
      videoCompletions: parseNumber(row[12]),
      totalEngagements: parseNumber(row[13]),
      veiculo: normalizeVeiculo(row[17] || ''),
      tipoDeCompra: row[19] || '',
      videoEstaticoAudio: row[14] || '',
      image: row[15] || '',
      campanha: row[22] || '',
      numeroPi,
      cliente: row[24] || '',
      agencia: normalizeAgencia(row[16] || '')
    });
  });
  return data;
};

// Formato "Consolidado" de 28 colunas (IBMR, SENAC e similares):
// [0] Nome Conta, [1] ID Conta, [2] Data, [3] Device, [4] Campaign Name,
// [5] Campaign ID, [6] Ad Group Name, [7] Ad group ID, [8] Ad Name, [9] Ad ID,
// [10] Ad Final URL, [11] Cost (Spend), [12] Impressions, [13] Clicks,
// [14] Video View, [15] Views 25%, [16] Views 50%, [17] Views 75%,
// [18] Views 100%, [19] VA, [20] Agência, [21] Veículo, [22] Número PI,
// [23] Tipo de Compra, [24] Investimento, [25] Formato, [26] Campanha, [27] Cliente
const parseConsolidado28Rows = (rows: string[][]): ProcessedCampaignData[] => {
  const data: ProcessedCampaignData[] = [];
  rows.forEach(row => {
    if (row.length < 25) return;
    const numeroPi = row[22] || '';
    if (numeroPi === '#VALUE!') return;

    // A coluna "Campanha" costuma vir vazia nesta planilha; usa o Campaign Name
    // (taxonomia) como fallback para não descartar a linha no contexto.
    const campanha = (row[26] && row[26].trim()) || row[4] || '';

    data.push({
      date: parseConsolidadoDate(row[2]),
      campaignName: row[4] || '',
      adSetName: row[6] || '',
      adName: row[8] || '',
      cost: parseCurrency(row[24]),          // coluna Investimento
      impressions: parseNumber(row[12]),
      reach: 0,
      clicks: parseNumber(row[13]),
      videoViews: parseNumber(row[14]),
      videoViews25: parseNumber(row[15]),
      videoViews50: parseNumber(row[16]),
      videoViews75: parseNumber(row[17]),
      videoCompletions: parseNumber(row[18]),
      totalEngagements: 0,
      veiculo: normalizeVeiculo(row[21] || ''),
      tipoDeCompra: row[23] || '',
      videoEstaticoAudio: '',
      image: '',
      campanha,
      numeroPi,
      cliente: row[27] || '',
      agencia: normalizeAgencia(row[20] || '')
    });
  });
  return data;
};

export const fetchCampaignData = async (): Promise<ProcessedCampaignData[]> => {
  try {
    const [consolidadoResponses, consolidado28Responses] = await Promise.all([
      Promise.all(CONSOLIDADO_API_URLS.map(url => axios.get<ApiResponse>(url))),
      Promise.all(CONSOLIDADO_28COL_API_URLS.map(url => axios.get<ApiResponse>(url)))
    ]);

    const allData: ProcessedCampaignData[] = [];

    consolidadoResponses.forEach(response => {
      if (response.data.success && response.data.data.values.length > 1) {
        const rows = response.data.data.values.slice(1);
        allData.push(...parseConsolidadoRows(rows));
      }
    });

    consolidado28Responses.forEach(response => {
      if (response.data.success && response.data.data.values.length > 1) {
        const rows = response.data.data.values.slice(1);
        allData.push(...parseConsolidado28Rows(rows));
      }
    });

    return allData;
  } catch (error) {
    console.error('Erro ao buscar dados das campanhas:', error);
    throw error;
  }
};

export const fetchSearchTermsData = async (): Promise<ProcessedSearchData[]> => {
  try {
    const responses = await Promise.all(
      SEARCH_API_URLS.map(url => axios.get<ApiResponse>(url))
    );

    const allData: ProcessedSearchData[] = [];

    responses.forEach(response => {
      if (response.data.success && response.data.data.values.length > 1) {
        const rows = response.data.data.values.slice(1);

        rows.forEach(row => {
          if (row.length >= 6) {
            const impressions = parseNumber(row[4]);
            const clicks = parseNumber(row[5]);
            const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;

            const dataRow: ProcessedSearchData = {
              date: parseSearchDate(row[0]),
              campaignName: row[1] || '',
              searchTerm: row[2] || '',
              cost: parseNumber(row[3]),
              impressions,
              clicks,
              veiculo: row[6] || 'Google Search',
              campanha: row[7] || '',
              ctr
            };
            allData.push(dataRow);
          }
        });
      }
    });

    return allData;
  } catch (error) {
    console.error('Erro ao buscar dados de termos de busca:', error);
    throw error;
  }
};

export const fetchPricingTable = async (): Promise<PricingTableRow[]> => {
  try {
    const response = await axios.get<ApiResponse>(PRICING_API_URL);

    if (response.data.success && response.data.data.values.length > 1) {
      const rows = response.data.data.values.slice(1); // Pula o header

      const pricingData: PricingTableRow[] = rows.map(row => ({
        veiculo: row[0] || '',
        canal: row[1] || '',
        formato: row[2] || '',
        tipoDeCompra: row[3] || '',
        valorUnitario: parseCurrency(row[4]),
        desconto: parsePercentage(row[5]),
        valorFinal: parseCurrency(row[6])
      }));

      return pricingData;
    }

    return [];
  } catch (error) {
    console.error('Erro ao buscar tabela de preços:', error);
    throw error;
  }
};

/**
 * Converte dados do Google Search para o formato ProcessedCampaignData
 */
export const convertSearchDataToCampaignData = (searchData: ProcessedSearchData[]): ProcessedCampaignData[] => {
  return searchData.map(item => ({
    date: item.date,
    campaignName: item.campaignName,
    adSetName: item.searchTerm,
    adName: item.searchTerm,
    cost: item.cost,
    impressions: item.impressions,
    reach: 0,
    clicks: item.clicks,
    videoViews: 0,
    videoViews25: 0,
    videoViews50: 0,
    videoViews75: 0,
    videoCompletions: 0,
    totalEngagements: 0,
    veiculo: 'Google Search',
    tipoDeCompra: 'CPC',
    videoEstaticoAudio: '',
    image: '',
    campanha: item.campanha,
    numeroPi: '',
    cliente: '',
    agencia: ''
  }));
};

/**
 * Busca informações de um PI específico
 */
export const fetchPIInfo = async (numeroPi: string) => {
  try {
    const response = await axios.get(PI_INFO_API_URL);

    if (!response.data.success || !response.data.data.values) {
      throw new Error('Formato de resposta inválido');
    }

    const values = response.data.data.values;

    // Remove zeros à esquerda para comparação
    const normalizedPi = numeroPi.replace(/^0+/, '');

    // Encontra todas as linhas com o número PI especificado
    // Compara removendo zeros à esquerda de ambos os lados
    const piRows = values.slice(1).filter((row: string[]) => {
      const rowPi = (row[2] || '').replace(/^0+/, '');
      return rowPi === normalizedPi;
    });

    if (piRows.length === 0) {
      return null;
    }

    // Agrupa informações por veículo
    // Colunas: [0] Agência, [1] Cliente, [2] Número PI, [3] Veículo, [4] Canal,
    //          [5] Formato, [6] Modelo Compra, [7] Valor Uni, [8] Desconto,
    //          [9] Valor Negociado, [10] Qtd, [11] TT Bruto, [12] Reaplicação,
    //          [13] Status, [14] Segmentação, [15] Alcance, [16] Inicio, [17] Fim,
    //          [18] Público, [19] Praça, [20] Objetivo
    const piInfo = piRows.map((row: string[]) => ({
      numeroPi: row[2] || '',
      veiculo: row[3] || '',
      canal: row[4] || '',
      formato: row[5] || '',
      modeloCompra: row[6] || '',
      valorNegociado: row[9] || '',
      quantidade: row[10] || '',
      totalBruto: row[11] || '',
      status: row[13] || '',
      segmentacao: row[14] || '',
      alcance: row[15] || '',
      inicio: row[16] || '',
      fim: row[17] || '',
      publico: row[18] || '',
      praca: row[19] || '',
      objetivo: row[20] || ''
    }));

    return piInfo;
  } catch (error) {
    console.error('Erro ao buscar informações do PI:', error);
    return null;
  }
};

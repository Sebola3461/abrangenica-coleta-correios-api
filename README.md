# Abrangência LRS Correios

API que informa se um CEP é atendido pela **Logística Reversa dos Correios** em cada modalidade: SEDEX Reverso, PAC Reverso e Disque Coleta.

Os dados vêm da [planilha pública de abrangência dos Correios](https://www2.correios.com.br/encomendas/servicosOnline/logisticaReversa/abrangencia/dsp/listaAreaAbrangenciaExcel.cfm). Um GitHub Action baixa a planilha todos os dias e salva um snapshot em `data/abrangencia.json`. A API responde a partir desse snapshot, em memória, sem chamar os Correios a cada requisição.

Feito em Next.js para deploy na Vercel.

## Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/v1/abrangencia/coleta/{cep}` | Abrangência do CEP por modalidade |
| `GET` | `/api/v1/meta` | Data e hash do snapshot, totais e faixas descartadas |
| `GET` | `/docs` | Swagger UI |
| `GET` | `/openapi.json` | Especificação OpenAPI 3.1 |

### Exemplo

```bash
curl https://SEU-DEPLOY.vercel.app/api/v1/abrangencia/coleta/12200-000
```

```json
{
  "cep": "12200000",
  "cepFormatado": "12200-000",
  "atendido": true,
  "modalidades": {
    "sedexReverso": {
      "servico": "SEDEX Reverso",
      "aceito": true,
      "unidades": [
        {
          "unidade": "CEE SAO JOSE DOS CAMPOS",
          "dr": "SE/SPI",
          "prazo": "D + 1",
          "prazoDias": 1,
          "cepInicial": "12200-000",
          "cepFinal": "12229-999"
        }
      ]
    },
    "pacReverso": { "servico": "PAC Reverso", "aceito": true, "unidades": [ "..." ] },
    "disqueColeta": { "servico": "Disque Coleta", "aceito": false, "unidades": [] }
  },
  "dados": {
    "atualizadoEm": "2026-10-19T14:54:56.105Z",
    "fonte": "https://www2.correios.com.br/encomendas/servicosOnline/logisticaReversa/abrangencia/dsp/listaAreaAbrangenciaExcel.cfm"
  }
}
```

### Regras

- **Formato do CEP:** 8 dígitos, com hífen e ponto opcionais (`01310100`, `01310-100` e `01.310-100` são aceitos). Qualquer outro formato, ou `00000-000`, retorna `400` com `CEP_INVALIDO`.
- **CEP sem cobertura:** retorna `200` com `atendido: false`. Não é tratado como erro.
- **Mais de uma unidade:** a planilha tem faixas sobrepostas, então uma modalidade pode listar várias unidades de coleta.
- **Localidade:** a API confere o formato do CEP e se ele está nas faixas da planilha. Ela não confirma que o CEP existe.
- **Cache:** as respostas saem com `Cache-Control: s-maxage=86400`, ou seja, ficam 24 h na CDN da Vercel. Cada deploy limpa esse cache.
- **CORS:** liberado para qualquer origem (`Access-Control-Allow-Origin: *`).

## Dados

A planilha dos Correios vem com extensão `.xls`, mas é uma tabela HTML em ISO-8859-1 com cerca de 16 mil linhas. O script [`scripts/sync.ts`](scripts/sync.ts) faz o seguinte:

1. Baixa a planilha, tentando até 4 vezes com espera crescente entre as tentativas.
2. Confere o cabeçalho, o número mínimo de linhas e se os serviços são conhecidos. Se algo não bate, **falha** e não grava nada.
3. Descarta faixas com o CEP inicial maior que o final (erros de digitação na origem) e lista essas faixas em `/api/v1/meta`.
4. Grava `data/abrangencia.json` **somente se o conteúdo mudou**, comparando o `sha256` do conteúdo normalizado.

O arquivo tem uma faixa por linha, para o `git diff` mostrar exatamente o que mudou na cobertura.

### Atualização automática

O workflow [`.github/workflows/sync.yml`](.github/workflows/sync.yml) roda todos os dias às 06:00 (horário de Brasília). Quando os dados mudam, ele faz commit em `data/abrangencia.json`. A Vercel vê o push e publica a nova versão.

Para atualizar na hora: **Actions → Sincronizar planilha dos Correios → Run workflow**.

Se a sincronização falhar (Correios fora do ar ou layout da planilha alterado), o job fica vermelho e a API continua servindo o último snapshot válido.

A decisão de usar snapshot em vez de consultar os Correios a cada requisição está registrada em [docs/adr/0001-fonte-de-dados-e-arquitetura-da-api.md](docs/adr/0001-fonte-de-dados-e-arquitetura-da-api.md).

## Rodando localmente

Requer Node.js 20 ou mais recente (o CI usa 24).

```bash
npm install
npm run dev          # http://localhost:3000/docs
```

| Script | O que faz |
|--------|-----------|
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` | Build de produção |
| `npm start` | Sobe o build de produção |
| `npm test` | Testes (Vitest) |
| `npm run typecheck` | Checagem de tipos |
| `npm run sync` | Baixa a planilha e atualiza o snapshot (`-- --force` regrava mesmo sem mudança) |

## Deploy na Vercel

1. Suba o repositório no GitHub.
2. Na Vercel, clique em **Add New → Project** e importe o repositório. O framework é detectado como Next.js e não há variáveis de ambiente.
3. No GitHub, em **Settings → Actions → General → Workflow permissions**, marque **Read and write permissions** para o workflow de sincronização conseguir fazer commit.

## Estrutura

```
src/
  app/
    api/v1/abrangencia/coleta/[cep]/route.ts   consulta por CEP
    api/v1/meta/route.ts                       metadados do snapshot
    docs/route.ts                              Swagger UI
  lib/
    planilha.ts      parse e validação da planilha
    abrangencia.ts   busca do CEP nas faixas
    cep.ts           normalização e formatação de CEP
    snapshot.ts      carrega data/abrangencia.json
scripts/sync.ts      sincronização com os Correios
data/abrangencia.json
public/openapi.json
docs/adr/            decisões de arquitetura
```

## Aviso

Projeto independente, sem vínculo com os Correios. A fonte oficial continua sendo a planilha publicada pelos Correios.
